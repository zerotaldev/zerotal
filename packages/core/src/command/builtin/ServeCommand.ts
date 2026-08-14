/**
 * The `serve` command, which starts the HTTP server. Also drives dev mode: the
 * file-watching orchestrator (process 1) and the managed dev worker (process 2).
 */
import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { hasDevBuildHooks, runDevBuildHooks } from "../../dev/DevBuildHook.ts";
import { buildConfiguredAssets, type AssetBuildConfig } from "../../dev/CssPlugins.ts";
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
  type PortOwner,
} from "../../support/port.ts";
import { localNetworkAddress } from "../../support/network.ts";
import { createInterface } from "node:readline";

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
      description: "Port to listen on",
      default: 3000,
    },
    {
      name: "dev",
      type: "boolean",
      description: "Start in dev mode with file watching, auto-rebuild, and browser reload",
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

  async run(): Promise<void> {
    const isDev = this.flags["dev"] as boolean;
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

    const port = await this._resolvePort(this.flags["port"] as number, isWorker);
    const assets = this._assetsConfig();

    // ── DEV WORKER (Process 2) ──────────────────────────────────────────────
    // Normal server start, but:
    //   1. Registers GET /__dev/events for browser SSE reload.
    //   2. Reads stdin: when it sees "reload", broadcasts to SSE clients.
    if (isWorker) {
      const app = this.app as import("../../application/Application.ts").Application;

      // Enable the /__dev/ws HMR WebSocket endpoint.
      app.enableDevWs();

      // Listen on stdin for reload signals from the Orchestrator (Process 1).
      this._listenForReloadSignals();

      // The application logs "Server listening on …" once it binds; announcing it
      // here as well printed the same fact twice, in two different formats.
      await app.start(port);
      await new Promise<never>(() => {});
      return;
    }

    // ── PRODUCTION / normal start ────────────────────────────────────────────
    // Build configured assets once before serving (dev mode builds via the orchestrator).
    if (assets) await this._buildAssets(assets);

    // Announced after the bind, not before: booting logs its own progress, and a
    // banner printed first ends up buried above it — worse, it would promise a
    // URL that a failed bind never makes good on.
    await (this.app as Application).start(port);
    this._announce("serve", port);
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

    const port = await this._resolvePort(this.flags["port"] as number, false);
    this._announce("dev", port);

    // Every view package (Inertia/Flow) that registered a build routine gets
    // run on each change; otherwise synthesise one from `app.assets` so
    // configured assets rebuild on change.
    let buildHook: (() => Promise<{ success: boolean; logs?: unknown[] }>) | undefined =
      hasDevBuildHooks() ? runDevBuildHooks : undefined;
    if (!buildHook && assets) {
      buildHook = (): Promise<{ success: boolean; logs?: unknown[] }> =>
        buildConfiguredAssets(assets, process.cwd());
    }

    if (!buildHook) {
      // No Inertia (or no frontend build configured). Fall back to simple
      // bun --watch restart so the developer still gets auto-reload.
      //
      // Deliberately keeps the terminal to itself: `bun --watch` needs stdin,
      // and a deck drawn over a process we are not supervising would show tabs
      // that no key could restart.
      this.warn("  [zerotal:dev] no build hook registered — falling back to bun --watch");
      if (processes.some((entry) => entry.name !== SERVER_PROCESS_NAME)) {
        this.dim("  [zerotal:dev] dev processes are not supervised on this path.");
      }
      const subprocess = Bun.spawn(["bun", "--watch", Bun.main, "serve", "--port", String(port)], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        // The port is already settled here, and each --watch restart races
        // the socket the previous run is still letting go of. Without this
        // the child would re-prompt on every save.
        env: { ...Bun.env, [PORT_RESOLVED_ENV_VAR]: "1" },
      });
      await subprocess.exited;
      return;
    }

    await startDevMode({
      port,
      cwd: process.cwd(),
      build: buildHook,
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
        ],
        4,
      );
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

  /**
   * The banner a starting server prints: the mode, then one URL per way in.
   *
   * The server binds every interface (`Bun.serve()` defaults to `0.0.0.0`), so
   * the network URL is not an invitation to configure anything — it is the
   * address a phone on the same Wi-Fi can already open, spared the `ipconfig`.
   */
  private _announce(mode: string, port: number): void {
    const network = localNetworkAddress();

    this.newLine();
    this.line(`  Zerotal  ›  ${mode}`);
    this.newLine();
    this._route("Local", `http://localhost:${port}`);
    this._route(
      "Network",
      network ? `http://${network}:${port}` : "unavailable — this machine is on no network",
    );
    this.newLine();
  }

  /** One `label   url` row of the banner: dim label, cyan value. */
  private _route(label: string, value: string): void {
    this._writer.writeLine(`  \x1b[2m${label.padEnd(9)}\x1b[0m\x1b[36m${value}\x1b[0m`);
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

    return this._askAboutPort(requested, owner, held);
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

  /** Read the resolved `app.assets` config block, or undefined when not configured. */
  private _assetsConfig(): AssetBuildConfig | undefined {
    try {
      const config = (this.app as Application).container.makeSync("config") as ConfigManager;
      return config.get("app.assets") as AssetBuildConfig | undefined;
    } catch {
      return undefined;
    }
  }

  /** Bundle the configured assets, reporting any build failure (non-fatal — the server still starts). */
  private async _buildAssets(assets: AssetBuildConfig): Promise<void> {
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

    readline.on("line", (line: string) => {
      const trimmed = line.trim();
      // The orchestrator sends `reload` or `reload:<assetVersion>`. Update the
      // asset version (so `asset()` emits a fresh ?v=) before broadcasting.
      if (trimmed === "reload" || trimmed.startsWith("reload:")) {
        const version = trimmed.slice("reload:".length);
        if (version) setAssetVersion(version);
        DevWsServer.broadcast("reload");
      }
    });

    // If stdin closes (the orchestrator died), exit cleanly.
    readline.on("close", () => process.exit(0));
  }
}

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
