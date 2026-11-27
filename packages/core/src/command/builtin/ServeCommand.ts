/**
 * The `serve` command, which starts the HTTP server. Also drives dev mode: the
 * file-watching orchestrator (process 1) and the managed dev worker (process 2).
 */
import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { hasDevBuildHooks, runDevBuildHooks } from "../../dev/DevBuildHook.ts";
import { buildConfiguredAssets, type AssetBuildConfig } from "../../dev/CssPlugins.ts";
import { bootBuildDecision } from "../../dev/bootBuild.ts";
import { deployEnv } from "../../support/env.ts";
import { collectDevProcesses, type ResolvedDevProcess } from "../../dev/DevProcess.ts";
import { startDevMode, SERVER_PROCESS_NAME } from "../../dev/startDevMode.ts";
import type { ConfigManager } from "../../config/ConfigManager.ts";
import type { Application } from "../../application/Application.ts";
import * as DevWsServer from "../../dev/DevWsServer.ts";
import { setAssetVersion } from "../../assets/assets.ts";
import {
  isPortAvailable,
  waitForPort,
  findAvailablePort,
  findPortOwner,
  stopProcess,
  PORT_RESOLVED_ENV_VAR,
  _servePort,
  type PortOwner,
} from "../../support/port.ts";
import { localNetworkAddress } from "../../support/network.ts";
import { ZEROTAL_VERSION } from "../../support/version.ts";
import { createInterface } from "node:readline";
import type { DevWatchPaths } from "../../dev/DevOrchestrator.ts";
import { _forStream } from "../../logger/color.ts";
import { _bootImportFailures } from "../../conventions/ConventionLoader.ts";

/**
 * `bun zt serve` — starts the HTTP server (and orchestrates dev mode when
 * `--dev` is set). Aliased as `start` and `s`.
 *
 * @category Serving
 */
export class ServeCommand extends Command {
  static commandName = "serve";
  static aliases = ["start", "s"];
  static description = "Start the HTTP server";
  static needsApp = true;

  static flags: FlagDef[] = [
    {
      name: "port",
      short: "p",
      type: "number",
      // No default here: one would always win, and `app.port` (from `PORT`) would never be read.
      description: "Port to listen on (default: app.port, which is PORT or 3000)",
    },
    {
      name: "host",
      type: "string",
      description: "Interface to bind (default: every interface; `zt dev` binds 127.0.0.1)",
    },
    {
      // Declared only so it can be refused by name, with the command to run instead.
      // Undeclared, it would be refused too (since 1.19.0 every undeclared option is),
      // but with a generic message; before that, `serve --dev` went on starting a plain
      // server with no watcher and no message.
      name: "dev",
      type: "boolean",
      description: "Retired in 1.13.0 — use `zt dev`",
      default: false,
    },
    {
      name: "force",
      type: "boolean",
      description: "If the port is busy, stop the process holding it",
      default: false,
    },
    {
      name: "auto-port",
      type: "boolean",
      description: "If the port is busy, start on the next free port",
      default: false,
    },
    // Internal flag — spawned by DevOrchestrator; not shown in help
    {
      name: "dev-worker",
      type: "boolean",
      description: "Internal: run as the managed server process under DevOrchestrator",
      default: false,
    },
  ];

  /**
   * Set by {@link DevCommand} rather than by a flag, so `serve --dev` can be
   * refused while `dev` keeps the supervisor it subclasses.
   *
   * @internal
   */
  protected _dev = false;

  async run(): Promise<void> {
    if (this.flags["dev"] === true && !this._dev) {
      this.error(
        "`serve --dev` was retired in 1.13.0. Use `bun zt dev` — it is the same supervisor, " +
          "the same processes and the same restart behaviour, plus the flags that only make " +
          "sense with a deck on screen (--only, --without, --list, --stream).",
      );
      process.exitCode = 1;
      return;
    }

    const isDev = this._dev;
    const isWorker = this.flags["dev-worker"] as boolean;

    // ── DEV ORCHESTRATOR (Process 1) ────────────────────────────────────────
    // Spawns and manages the server child process, watches files, drives builds.
    //
    // Handled before the port is resolved, because in dev mode the port is not
    // always needed: `--list` starts nothing, and `--only=queue` starts no
    // server. Resolving first turns either into a prompt about killing whatever
    // holds port 3000 — or a hard failure with no TTY — over a port that was
    // never going to be bound.
    if (isDev) {
      await this._runDevMode();
      return;
    }

    const port = await this._resolvePort(this._wantedPort(), isWorker);
    const assets = this._assetsConfig();

    // ── DEV WORKER (Process 2) ──────────────────────────────────────────────
    // Normal server start, but:
    //   1. Serves the /__dev/ws reload socket and /__dev/reload.js, its client.
    //   2. Reads stdin: when it sees "reload", broadcasts it to every connected tab.
    if (isWorker) {
      const app = this.app as import("../../application/Application.ts").Application;

      // Refresh types/routes.generated.ts from the routes this boot registered.
      // The worker is the right place for it: the orchestrator restarts the
      // worker on every route-file change, so this runs exactly when the route
      // table can have changed, and it reads a booted router rather than
      // re-deriving names from filenames.
      await this._writeRouteTypes();

      // Enable the /__dev/ws HMR WebSocket endpoint.
      app.enableDevWs();

      // Listen on stdin for reload signals from the Orchestrator (Process 1).
      this._listenForReloadSignals();

      // The application logs "Server listening on …" once it binds; announcing it
      // here as well printed the same fact twice, in two different formats.
      await app.start(port, this._host());
      await new Promise<never>(() => {});
      return;
    }

    // ── PRODUCTION / normal start ────────────────────────────────────────────
    // Build configured assets once before serving (dev mode builds via the orchestrator).
    if (assets) await this._buildAssets(assets);

    // Announced after the bind, not before: booting logs its own progress, and a
    // banner printed first ends up buried above it — worse, it would promise a
    // URL that a failed bind never makes good on.
    const host = this._host();
    await (this.app as Application).start(port, host);
    this._announce("serve", port, host);
    await new Promise<never>(() => {});
  }

  // ── Dev mode ───────────────────────────────────────────────────────────────

  /**
   * Everything `--dev` does, shared verbatim with `bun zt dev`.
   *
   * `protected` rather than private because {@link DevCommand} is this command
   * with a richer flag set — keeping one body is what stops the two from
   * disagreeing about what dev mode is.
   */
  protected async _runDevMode(): Promise<void> {
    const processes = await this._devProcesses();

    if (this.flags["list"]) {
      this._listDevProcesses(processes);
      return;
    }

    // Item C: the cache is keyed on file mtime and size, which a same-size edit
    // that preserves mtime slips past. This is the escape hatch for that, and
    // for the "I don't believe the cache" moment every cache eventually causes.
    if (this.flags["force-build"]) {
      (Bun.env as Record<string, string>)["ZT_NO_BUILD_CACHE"] = "1";
    }

    const wantsServer = processes.some((entry) => entry.name === SERVER_PROCESS_NAME);
    const assets = this._assetsConfig();

    if (!wantsServer) {
      // `--only=queue`, say. No port to bind and no assets to build — just the
      // supervisor and the deck, so a busy port is nobody's problem.
      await startDevMode({
        port: 0,
        cwd: process.cwd(),
        processes,
        writer: this._writer,
        deckMode: this.flags["stream"] ? "stream" : undefined,
      });
      return;
    }

    const port = await this._resolvePort(this._wantedPort(), false);
    // Loopback unless asked: a dev server answers with stack traces, source and the
    // inspector, which are for this machine. `--host 0.0.0.0` opens it to the network,
    // for a phone on the same Wi-Fi or a port published from a container.
    const host = this._host() ?? DEV_HOST;
    this._announce("dev", port, host);

    // Every view package (Inertia/Flow) that registered a build routine gets
    // run on each change; otherwise synthesise one from `app.assets` so
    // configured assets rebuild on change. An app with neither (an API) has
    // nothing to build, and gets the same supervised server, deck, queue tab and
    // startup-error page without one.
    let buildHook: (() => Promise<{ success: boolean; logs?: unknown[] }>) | undefined =
      hasDevBuildHooks() ? runDevBuildHooks : undefined;
    if (!buildHook && assets) {
      buildHook = (): Promise<{ success: boolean; logs?: unknown[] }> =>
        buildConfiguredAssets(assets, process.cwd());
    }

    await startDevMode({
      port,
      cwd: process.cwd(),
      build: buildHook,
      host,
      watch: this._config()?.get<DevWatchPaths>("app.dev.watch"),
      processes,
      writer: this._writer,
      deckMode: this.flags["stream"] ? "stream" : undefined,
    });
  }

  /**
   * What dev mode should run, after `--only` / `--without`.
   *
   * The server is prepended as an ordinary entry so the two filters need no
   * special case for it — `--only=queue` really does mean "just the queue", and
   * says so by leaving the server out of the list rather than by ignoring you.
   */
  protected async _devProcesses(): Promise<ResolvedDevProcess[]> {
    const app = this.app as Application;
    const server: ResolvedDevProcess = {
      name: SERVER_PROCESS_NAME,
      label: SERVER_PROCESS_NAME,
      color: "green",
      restart: "on-failure",
      after: "none",
      registrant: "@zerotal/core",
    };

    let contributed: ResolvedDevProcess[] = [];
    try {
      contributed = await collectDevProcesses(app, this._config());
    } catch (error) {
      // A badly-formed definition names its registrant. Reporting and carrying
      // on beats refusing to start the server over another package's typo.
      this.error(`  ${error instanceof Error ? error.message : String(error)}`);
    }

    const only = _names(this.flags["only"]);
    const without = _names(this.flags["without"]);

    return [server, ...contributed].filter((entry) => {
      if (only.length > 0 && !only.includes(entry.name)) return false;
      return !without.includes(entry.name);
    });
  }

  /** `--list`: what would run, and who asked for it. */
  private _listDevProcesses(processes: ResolvedDevProcess[]): void {
    if (this.flags["json"] === true) {
      const document: DevListJson = {
        processes: processes.map((entry) => ({
          name: entry.name,
          label: entry.label,
          argv: entry.run ? null : (entry.argv ?? null),
          inProcess: entry.run !== undefined,
          registeredBy: entry.registrant,
          restart: entry.restart,
          after: entry.after,
          restartsWithServer: entry.restartOnChange === true,
        })),
      };
      this.json(document);
      return;
    }
    this.section("Dev processes");
    if (processes.length === 0) {
      this.dim("  Nothing to run — every process was filtered out.");
      return;
    }
    for (const entry of processes) {
      const command = entry.run
        ? "(in-process)"
        : (entry.argv?.join(" ") ?? "(managed by the orchestrator)");
      this.line(`  ${entry.name}`);
      this.table(
        [
          ["command", command],
          ["registered by", entry.registrant],
          ["restart", entry.restart],
          ["after", entry.after],
          ...(entry.restartOnChange ? _ON_CHANGE_ROW : []),
        ],
        4,
      );
    }
  }

  /**
   * Refresh the generated route-name map from this boot's router.
   *
   * Best-effort by design: a read-only project directory (a container mount, a
   * sandbox) must not take the dev server down over a types file, and the app
   * still runs perfectly well without it — only the compile-time check is lost.
   */
  private async _writeRouteTypes(): Promise<void> {
    // A boot that skipped a file it could not import is missing that file's routes, and
    // writing the map from it would turn every link to them into a type error.
    const failed = _bootImportFailures();
    if (failed.length > 0) {
      this.dim(`  [zerotal:dev] route types not written: ${failed.length} file(s) did not import`);
      return;
    }
    try {
      const { writeRouteTypes } = await import("../../router/routeTypes.ts");
      const { Router } = await import("../../router/Router.ts");
      const result = await writeRouteTypes(Router.namedRoutes);
      if (result.changed) this.dim(`  [zerotal:dev] wrote ${result.path} (${result.count} routes)`);
    } catch (error) {
      this.dim(`  [zerotal:dev] could not write route types: ${error}`);
    }
  }

  /** The config manager, or undefined when the app has none bound. */
  private _config(): { get<T>(key: string, fallback?: T): T | undefined } | undefined {
    try {
      return (this.app as Application).container.makeSync("config") as ConfigManager;
    } catch {
      return undefined;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** The `--host` flag, when one was given. */
  private _host(): string | undefined {
    const host = this.flags["host"];
    return typeof host === "string" && host.trim() !== "" ? host.trim() : undefined;
  }

  /**
   * The banner a starting server prints: the mode, then one URL per way in.
   *
   * The Network line appears only when the server answers the network: bound to
   * every interface (`serve` by default, `zt dev --host 0.0.0.0`) it is the
   * address a phone on the same Wi-Fi can open, spared the `ipconfig`; bound to
   * one address it is that address. A loopback server (`zt dev` by default) has
   * no Network line, because nothing on the network can reach it.
   */
  private _announce(mode: string, port: number, host: string | undefined): void {
    const network = _networkUrl(host, port);

    this.newLine();
    // The version is here because a running server holds the framework it booted
    // with: an upgrade installed in another terminal is invisible until a full
    // restart, and without this line there is nothing on screen to tell you which
    // one you are looking at.
    this.line(`  Zerotal v${ZEROTAL_VERSION}  ›  ${mode}`);
    this.newLine();
    // Bound to one address of the network (`--host 192.168.1.20`), localhost does not answer.
    const wildcard = host === "0.0.0.0" || host === "::" || host === "[::]";
    if (host === undefined || wildcard || _isLoopback(host)) {
      this._route("Local", `http://localhost:${port}`);
    }
    if (network !== null) this._route("Network", network);
    this.newLine();
  }

  /** One `label   url` row of the banner: dim label, cyan value. */
  private _route(label: string, value: string): void {
    this._writer.writeLine(_forStream(`  \x1b[2m${label.padEnd(9)}\x1b[0m\x1b[36m${value}\x1b[0m`));
  }

  /**
   * Settle which port to actually bind, dealing with a busy one before the
   * server tries and fails.
   *
   * A supervised process — the dev worker, or the `bun --watch` child — is
   * handed a port that was already resolved by its parent and has no terminal
   * of its own, so it waits the port out instead of asking. Everyone else gets
   * the `--force` / `--auto-port` flags, then an interactive menu, then (with no
   * TTY, e.g. CI or a container) a hard error.
   */
  private async _resolvePort(requested: number, isWorker: boolean): Promise<number> {
    if (await isPortAvailable(requested)) return requested;

    const supervised = isWorker || Bun.env[PORT_RESOLVED_ENV_VAR] === "1";
    if (supervised) {
      // A restart, not a collision: the server being replaced is still letting
      // go of the socket.
      if (await waitForPort(requested, 3_000)) return requested;
      throw new Error(`Port ${requested} is still in use. Stop what is holding it and retry.`);
    }

    const owner = await findPortOwner(requested);
    const held = `Port ${requested} is already in use${_describe(owner)}.`;

    if (this.flags["force"]) return this._reclaimPort(requested, owner, held);
    if (this.flags["auto-port"]) return this._nextPort(requested, held);

    if (!process.stdin.isTTY) {
      throw new Error(
        `${held} Free it, or pass --port <n>, --force (stop it), or --auto-port (use the next free port).`,
      );
    }

    try {
      return await this._askAboutPort(requested, owner, held);
    } finally {
      // Handed back here, where it was taken. What runs next on this path — the
      // dev deck, or a `bun --watch` child with inherited stdio — takes the
      // terminal over, and cannot while the menu still holds the read lock.
      this.releaseStdin();
    }
  }

  /**
   * Offer the two ways out of a busy port. The menu is written by hand rather
   * than with `choice()` because that helper resolves unrecognised input to the
   * first option, and no typo should end up killing a process.
   */
  private async _askAboutPort(
    requested: number,
    owner: PortOwner | undefined,
    held: string,
  ): Promise<number> {
    const next = await findAvailablePort(requested + 1);

    this.newLine();
    this.warn(`  ${held}`);
    this.dim(`  [1] Stop it and use port ${requested}`);
    this.dim(next ? `  [2] Use port ${next} instead` : "  [2] Use another port (none free nearby)");
    this.dim("  [3] Cancel");

    const answer = await this.ask("  Choose", next ? "2" : "3");
    this.newLine();

    if (answer === "1") return this._reclaimPort(requested, owner, held);
    if (answer === "2" && next) return next;
    throw new Error(`${held} Nothing started.`);
  }

  /** Stop whatever holds the port, then confirm it actually let go. */
  private async _reclaimPort(
    port: number,
    owner: PortOwner | undefined,
    held: string,
  ): Promise<number> {
    if (!owner) {
      throw new Error(`${held} The process holding it could not be identified — free it manually.`);
    }
    // Never turn "free the port" into "kill the CLI asking about it".
    if (owner.pid === process.pid) {
      throw new Error(`${held} This process is holding it.`);
    }

    this.info(`  Stopping ${owner.name ?? "process"} (pid ${owner.pid})...`);
    const stopped = await stopProcess(owner.pid);

    // Even a successful kill leaves the socket closing, so wait for the port
    // itself rather than trusting the exit.
    if (!stopped || !(await waitForPort(port, 3_000))) {
      throw new Error(
        `Could not free port ${port} (pid ${owner.pid}). Stop it manually, or pass --port <n>.`,
      );
    }
    return port;
  }

  /** The next free port after a busy one, for `--auto-port`. */
  private async _nextPort(requested: number, held: string): Promise<number> {
    const next = await findAvailablePort(requested + 1);
    if (next === undefined) throw new Error(`${held} No free port found nearby.`);
    this.warn(`  ${held} Using port ${next}.`);
    return next;
  }

  /** The port asked for: `--port`, else `app.port` (which defaults to `PORT`), else 3000. */
  private _wantedPort(): number {
    return _servePort(this.flags["port"], this._config()?.get<number>("app.port"));
  }

  /** Read the resolved `app.assets` config block, or undefined when not configured. */
  private _assetsConfig(): AssetBuildConfig | undefined {
    try {
      const config = (this.app as Application).container.makeSync("config") as ConfigManager;
      return config.get("app.assets") as AssetBuildConfig | undefined;
    } catch {
      return undefined;
    }
  }

  /** The resolved `app.env`, or undefined when the config store is unavailable. */
  private _appEnv(): string | undefined {
    try {
      const config = (this.app as Application).container.makeSync("config") as ConfigManager;
      return config.get("app.env") as string | undefined;
    } catch {
      return undefined;
    }
  }

  /** Bundle the configured assets, reporting any build failure (non-fatal — the server still starts). */
  private async _buildAssets(assets: AssetBuildConfig): Promise<void> {
    // A production deployment that built its assets ahead of time and locked the tree
    // down is doing the right thing; rebuilding at boot would only fail. See bootBuild.ts.
    const decision = await bootBuildDecision(
      [`${process.cwd()}/${assets.outDir}`],
      (this._appEnv() ?? deployEnv()) as string | undefined,
    );
    if (!decision.build) {
      this.info(decision.reason ?? "Skipping the boot-time asset build.");
      return;
    }

    const entries = Array.isArray(assets.entrypoint)
      ? assets.entrypoint.join(", ")
      : assets.entrypoint;
    this.info(`Building assets: ${entries} → ${assets.outDir}/`);
    const result = await buildConfiguredAssets(assets, process.cwd());
    if (!result.success) {
      this.error("Asset build failed:");
      for (const log of result.logs ?? []) console.error(log);
    }
  }

  private _listenForReloadSignals(): void {
    const readline = createInterface({ input: process.stdin, terminal: false });

    readline.on("line", _onOrchestratorLine);

    // If stdin closes (the orchestrator died), exit cleanly.
    readline.on("close", () => process.exit(0));
  }
}

/**
 * One line from the dev orchestrator, on the worker's stdin.
 *
 * `reload` / `reload:<assetVersion>` after a good rebuild; `build-error:<json lines>` after a
 * failed one, and `build-ok` once a build works again. The tab shows a failure over the page it
 * has, instead of the server serving the last good bundle with nothing said.
 *
 * @internal Exported for tests.
 */
export function _onOrchestratorLine(line: string): void {
  const trimmed = line.trim();
  // Update the asset version (so `asset()` emits a fresh ?v=) before broadcasting.
  if (trimmed === "reload" || trimmed.startsWith("reload:")) {
    const version = trimmed.slice("reload:".length);
    if (version) setAssetVersion(version);
    DevWsServer._setBuildError(null);
    DevWsServer.broadcast("reload");
    return;
  }
  if (trimmed === "build-ok") {
    DevWsServer._setBuildError(null);
  } else if (trimmed.startsWith("build-error:")) {
    try {
      const lines = JSON.parse(trimmed.slice("build-error:".length)) as unknown;
      if (Array.isArray(lines)) DevWsServer._setBuildError(lines.map(String));
    } catch {
      /* a line that is not the orchestrator's — nothing to show */
    }
  }
}

/** What `zt dev` binds without `--host`. */
const DEV_HOST = "127.0.0.1";

/**
 * The banner's Network row for a server bound to `host`, or `null` for none.
 *
 * @param host - The `--host` value; absent means every interface, `Bun.serve()`'s default.
 * @internal Exported for tests.
 */
export function _networkUrl(
  host: string | undefined,
  port: number,
  address: () => string | undefined = localNetworkAddress,
): string | null {
  if (host !== undefined && _isLoopback(host)) return null;
  if (host === undefined || host === "0.0.0.0" || host === "::" || host === "[::]") {
    const network = address();
    return network ? `http://${network}:${port}` : "unavailable — this machine is on no network";
  }
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

/** Whether `host` names this machine only. */
function _isLoopback(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare === "::1" || /^127\./.test(bare);
}

/**
 * What `zt dev --list --json` prints: each process `zt dev` would run, after `--only` and
 * `--without`, in the order it would start them.
 */
export interface DevListJson {
  processes: {
    name: string;
    label: string;
    /**
     * The command it spawns, or `null` for one that runs inside the dev process (`inProcess`)
     * or that the orchestrator starts itself (the server).
     */
    argv: string[] | null;
    inProcess: boolean;
    /** The provider class that registered it, `"app.dev.processes"`, or `"@zerotal/core"`. */
    registeredBy: string;
    restart: "always" | "on-failure" | "never";
    after: "server" | "none";
    /** Restarted along with the server on a backend change. */
    restartsWithServer: boolean;
  }[];
}

/** The `--list` row for a process that restarts with the server. */
const _ON_CHANGE_ROW: [string, string][] = [["on change", "restarts with the server"]];

/** Split a `--only` / `--without` value into names. Absent means "no filter". */
function _names(flag: unknown): string[] {
  if (typeof flag !== "string") return [];
  return flag
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** `" by bun.exe (pid 1234)"`, or `""` when the holder could not be identified. */
function _describe(owner: PortOwner | undefined): string {
  if (!owner) return "";
  return owner.name ? ` by ${owner.name} (pid ${owner.pid})` : ` by pid ${owner.pid}`;
}
