/**
 * `bun zt deploy:<env>` — run a release, and refuse to finish it when something is
 * wrong.
 *
 * The framework already had the pieces: `zt doctor` finds silent misconfigurations,
 * config validators refuse an insecure production boot, `assets:build` builds a
 * release, `migrate` applies the schema. What it did not have was an order, and an
 * order is the whole value. Every deployment failure this framework has shipped has
 * the same shape — the HTML renders, the transport is dead, the health check passes
 * — and every one of them is cheaper to find before the cutover than after it.
 *
 * So: **everything that can refuse runs before anything that mutates.** A bad origin
 * list stops the deploy while the old release is still serving, rather than after
 * the migration has run and the new process is live and inert.
 *
 * What this deliberately does NOT do is restart the service or reach another
 * machine. It exits non-zero, and the thing that owns process lifecycle — systemd,
 * a container runtime, a deploy script — restarts only on success. The framework
 * has stayed out of that, and this keeps it out.
 */
import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import type { ConfigManager } from "../../config/ConfigManager.ts";
import type { CommandRunner } from "../CommandRunner.ts";
import { runDoctor } from "../../doctor/AppDoctor.ts";
import { probeTransport } from "../../doctor/TransportProbe.ts";
import { runConfigValidators } from "../../config/validation.ts";
import { deployEnv } from "../../support/env.ts";
import {
  CONVENTIONAL_PREFLIGHT_COMMAND,
  DEFAULT_DEPLOY_STEPS,
  type DeployTarget,
} from "../../config/DeployConfig.ts";

/**
 * The pipeline. Subclassed per target by {@link makeDeployCommand}, which is what
 * gives each environment its own command name.
 *
 * @internal Apps declare targets in `config/deploy.ts` and run `zt deploy:<env>`;
 * the class is how the runner builds those commands, not something to construct.
 */
export abstract class DeployCommand extends Command {
  /** The deployment this subclass releases to — `production`, `staging`, … */
  static target = "";
  static override needsApp = true;

  static override flags = [
    {
      name: "dry-run",
      type: "boolean" as const,
      description: "Print the steps that would run, and run none of them",
      default: false,
    },
    {
      name: "skip-migrations",
      type: "boolean" as const,
      description: "Do not run pending migrations as part of this release",
      default: false,
    },
    {
      name: "probe",
      type: "string" as const,
      description:
        "After the release, run a real WebSocket handshake against this URL (defaults to the target's `url`)",
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) throw new Error("deploy needs a booted application.");

    const target = (this.constructor as typeof DeployCommand).target;
    const dryRun = this.flags["dry-run"] === true;

    this.section(`Deploy → ${target}`);

    const steps = this._steps(app, target);
    if (dryRun) return this._printPlan(app, target, steps);

    await this._preflight(app, target);
    await this._runSteps(app, steps);
    await this._verify(app);
    await this._probe(app, target);

    this.newLine();
    this.info(`${target} release complete. Restart the service to pick it up.`);
  }

  // ── Phase 1 — preflight, which mutates nothing ──────────────────────────────

  /**
   * Refuse the deploy before it touches anything. Three questions, in the order
   * that makes a failure cheapest to act on: is this even the right machine, is
   * the configuration safe to deploy, and does the app pass its own checks.
   */
  private async _preflight(app: Application, target: string): Promise<void> {
    this.newLine();
    this.section("Preflight");

    // Is this the environment it claims to be? `deployEnv()` rather than APP_ENV,
    // which by now holds the runtime mode. Getting this wrong is how a production
    // pipeline migrates a staging database.
    const actual = deployEnv();
    if (actual !== target) {
      throw new Error(
        `This process was started as ${actual || "(unset)"}, not ${target}. ` +
          `Run it with APP_ENV=${target} so the config it loads is the one you are deploying.`,
      );
    }
    this.line(`✓ APP_ENV is ${target}`);

    // Re-run the config validators with production semantics. Boot already ran
    // them, but the findings only refuse a boot when the deployment is prod-like —
    // so on any other machine they were warnings nobody read.
    const config = this._config(app);
    if (!config) throw new Error("deploy needs a config store to validate.");
    const issues: string[] = [];
    try {
      runConfigValidators(app._configValidators, config, true, (m) => issues.push(m));
    } catch (error) {
      // Thrown when a fatal issue is found: that IS the answer, not a failure.
      for (const issue of (error as { issues?: Array<{ namespace: string; message: string }> })
        .issues ?? []) {
        issues.push(`config(${issue.namespace}): ${issue.message}`);
      }
    }
    if (issues.length > 0) {
      for (const issue of issues) this.error(`✗ ${issue}`);
      throw new Error(
        `${issues.length} config problem(s) would refuse a ${target} boot. Fix them before deploying.`,
      );
    }
    this.line(`✓ config is valid for a ${target} deployment`);

    await this._doctor(app, "preflight");
    await this._appPreflight(app, target);
  }

  /**
   * Run the app's own preflight commands — the refusals the framework is not in a
   * position to make.
   *
   * Last inside preflight, so the framework's cheap structural checks have already
   * spoken; still before every step, so nothing has been built or migrated when one
   * of these says no.
   */
  private async _appPreflight(app: Application, target: string): Promise<void> {
    const commands = this._preflightCommands(app, target);
    if (commands.length === 0) return;

    const runner = app.container.makeSync("commands") as CommandRunner;
    for (const name of commands) {
      const { code, output } = await runner.callInProcess([name]);
      if (output.trim()) this.line(output.trimEnd());
      if (code !== 0) {
        throw new Error(
          `${name} refused this release. Nothing has been built or migrated — ` +
            `fix what it reported and deploy again.`,
        );
      }
      this.line(`✓ ${name} passed`);
    }
  }

  /**
   * The preflight commands for this target: what `config/deploy.ts` declares, or
   * the conventional `release:check` when the app registers one.
   *
   * A declared name that is not registered is an error rather than a skip. That is
   * the opposite of how `steps` treats an absent command, and deliberately so: a
   * missing `inertia:build` means the app has no Inertia, while a missing gate
   * means the gate is not running, which is exactly the state this feature exists
   * to make impossible.
   */
  private _preflightCommands(app: Application, target: string): string[] {
    let runner: CommandRunner | undefined;
    try {
      runner = app.container.makeSync("commands") as CommandRunner | undefined;
    } catch {
      runner = undefined;
    }
    // Same reasoning as `_steps`: with no registry to ask, nothing can be
    // confirmed present. Returning nothing is the honest answer, and a declared
    // preflight will be checked again by `_appPreflight` when it goes to run one.
    if (!runner?.has) return [];

    const declared = this._target(app, target)?.preflight;
    if (declared === undefined) {
      return runner.has(CONVENTIONAL_PREFLIGHT_COMMAND) ? [CONVENTIONAL_PREFLIGHT_COMMAND] : [];
    }

    const missing = declared.filter((name) => !runner.has(name));
    if (missing.length > 0) {
      throw new Error(
        `config/deploy.ts declares preflight command(s) that are not registered: ` +
          `${missing.join(", ")}. A gate that silently does not run is worse than no gate.`,
      );
    }
    return [...declared];
  }

  // ── Phase 2 — build and migrate ─────────────────────────────────────────────

  /** The `config` store, or undefined when there is none to read. */
  private _config(app: Application): ConfigManager | undefined {
    try {
      return app.container.makeSync("config") as ConfigManager;
    } catch {
      return undefined;
    }
  }

  /** This target's declared settings, if `config/deploy.ts` names it. */
  private _target(app: Application, target: string): DeployTarget | undefined {
    return this._config(app)?.get<DeployTarget | undefined>(`deploy.targets.${target}`, undefined);
  }

  /** The release steps for this target, minus any whose command is not registered. */
  private _steps(app: Application, target: string): string[] {
    const wanted = this._target(app, target)?.steps ?? DEFAULT_DEPLOY_STEPS;
    let runner: CommandRunner | undefined;
    try {
      runner = app.container.makeSync("commands") as CommandRunner;
    } catch {
      runner = undefined;
    }
    // No registry to ask means nothing can be confirmed present — report the
    // declared list rather than silently claiming the release has no steps.
    if (!runner) return [...wanted];
    return [...wanted].filter((name) => runner.has(name));
  }

  private async _runSteps(app: Application, steps: string[]): Promise<void> {
    const runner = app.container.makeSync("commands") as CommandRunner;
    const skipMigrations = this.flags["skip-migrations"] === true;

    for (const name of steps) {
      if (name === "migrate" && skipMigrations) {
        this.newLine();
        this.warn("! migrate skipped (--skip-migrations)");
        continue;
      }

      this.newLine();
      this.section(name);
      const argv = name === "inertia:build" ? [name, "--production"] : [name];
      const { code, output } = await runner.callInProcess(argv);
      if (output.trim()) this.line(output.trimEnd());
      if (code !== 0) throw new Error(`${name} failed — stopping before the release completes.`);
    }
  }

  // ── Phase 3 — verify ────────────────────────────────────────────────────────

  /** The doctor again, now that migrations have run and the schema has one story. */
  private async _verify(app: Application): Promise<void> {
    this.newLine();
    this.section("Verify");
    await this._doctor(app, "verify");
  }

  /**
   * Run the doctor's checks directly rather than through the command, so a failure
   * is a value this pipeline can report on rather than a process exit.
   */
  private async _doctor(app: Application, phase: string): Promise<void> {
    const report = await runDoctor(app);
    const failures = report.filter((e) => e.result.status === "fail");
    const warnings = report.filter((e) => e.result.status === "warn");

    for (const { check, result } of [...failures, ...warnings]) {
      const line = `${result.status === "fail" ? "✗" : "!"} ${check.label} — ${result.message}`;
      if (result.status === "fail") this.error(line);
      else this.warn(line);
      if (result.fix) this.line(`    fix: ${result.fix}`);
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} check(s) failed at ${phase}. ` +
          `Nothing further has run — fix these and deploy again.`,
      );
    }
    this.line(
      `✓ ${report.length} checks passed${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
    );
  }

  // ── Phase 4 — probe, when asked ─────────────────────────────────────────────

  /**
   * A real handshake against the deployed site. Off unless asked, because the
   * release this command just built is not live until the service restarts — and
   * the framework does not do that. Useful on a re-deploy, or from a second
   * terminal after the restart.
   */
  private async _probe(app: Application, target: string): Promise<void> {
    const declared = this._target(app, target);
    const url = (this.flags["probe"] as string | undefined) ?? undefined;
    if (!url) return;
    const against = url === "true" ? declared?.url : url;
    if (!against) {
      throw new Error(
        `--probe needs a URL, and config/deploy.ts declares no \`url\` for ${target}.`,
      );
    }

    this.newLine();
    this.section("Probe");
    const paths = app.webSocketPaths();
    if (paths.length === 0) {
      this.line("✓ no WebSocket paths registered — nothing to probe.");
      return;
    }

    const results = await probeTransport(against, paths);
    let failures = 0;
    for (const result of results) {
      const line = `${result.ok ? "✓" : "✗"} ${result.url} — ${result.message}`;
      if (result.ok) this.line(line);
      else {
        this.error(line);
        failures++;
      }
      if (result.fix) this.line(`    fix: ${result.fix}`);
    }
    if (failures > 0) throw new Error(`${failures} transport path(s) are not reachable.`);
  }

  // ── --dry-run ───────────────────────────────────────────────────────────────

  private _printPlan(app: Application, target: string, steps: string[]): void {
    const actual = deployEnv();
    this.line(
      `APP_ENV       ${actual || "(unset)"}${actual === target ? "" : `  ✗ expected ${target}`}`,
    );
    this.line(`preflight     config validators, then ${"doctor"} checks`);
    for (const name of this._preflightCommands(app, target)) {
      this.line(`preflight     ${name}`);
    }
    for (const name of steps) {
      const skipped = name === "migrate" && this.flags["skip-migrations"] === true;
      this.line(`step          ${name}${skipped ? "  (skipped: --skip-migrations)" : ""}`);
    }
    this.line(`verify        doctor checks again`);
    this.newLine();
    // Worth saying out loud: the app booted to get here, so "nothing ran" is not
    // quite true — providers booted and the database connection was opened.
    this.warn("Dry run — no steps executed. (The app was booted to resolve them.)");
  }
}

/**
 * Build the command for one deploy target.
 *
 * A subclass rather than the closure seam (`runner.registerCommand`), because that
 * one hardcodes `needsApp = false` and this pipeline needs a booted app for the
 * doctor, the config and the registered WebSocket paths.
 *
 * @internal Called by the runner for each declared target.
 */
export function makeDeployCommand(target: string): DeployCommandClass {
  const Target = class extends DeployCommand {
    static override commandName = `deploy:${target}`;
    static override description = `Run the ${target} release pipeline`;
    static override target = target;
  };
  Object.defineProperty(Target, "name", { value: `DeployCommand<${target}>` });
  return Target;
}

/**
 * A concrete deploy command. `typeof DeployCommand` cannot be used: the base is
 * abstract, and the runner's registry holds constructible classes.
 *
 * @internal
 */
export interface DeployCommandClass {
  new (): DeployCommand;
  commandName: string;
  description?: string;
  needsApp?: boolean;
  args: typeof DeployCommand.args;
  flags: typeof DeployCommand.flags;
  target: string;
}
