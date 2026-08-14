/**
 * The supervisor process for dev mode: it builds assets, spawns the Zerotal
 * server as a child, watches the filesystem, and restarts or rebuilds on change.
 */
import { watch } from "node:fs";
import type { BuildHookFn } from "./DevBuildHook.ts";
import { DEV_WORKER_ENV_VAR } from "../support/env.ts";

/**
 * How the orchestrator reports to whatever is presenting dev mode.
 *
 * All optional, and all defaulting to the console. Without them the orchestrator
 * behaves exactly as it did before the deck existed — which is what keeps the
 * plain `bun --watch` path and the existing tests honest.
 */
export interface DevOrchestratorHooks {
  /**
   * Take the server's output instead of letting it inherit the terminal.
   *
   * Providing this is what turns the server into a card in the deck rather than
   * a process shouting over the tab bar.
   */
  onServerLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** The server's own lifecycle, so its tab can show state like any other. */
  onServerState?: (state: "starting" | "running" | "restarting" | "parked") => void;
  /** Dev-mode's own narration — rebuilds, restarts, failures. */
  onNotice?: (text: string, level: "info" | "warn" | "error") => void;
  /** Called once the first server has bound, for `after: "server"` processes. */
  onServerReady?: () => void | Promise<void>;
  /** Called on SIGINT/SIGTERM, before the process exits. */
  onCleanup?: () => void | Promise<void>;
}

/**
 * Dev Orchestrator — Process 1 of the two-process dev mode.
 *
 * Responsibilities:
 *   - Runs an initial pages-manifest sync + asset build before the server starts.
 *   - Spawns the Zerotal server (Process 2) as a child process with stdin piped.
 *   - Watches the filesystem and:
 *       • Backend change  → debounced server restart (150 ms)
 *       • Frontend change → debounced asset rebuild + browser reload signal (80 ms)
 *   - Writes `reload\n` to the child's stdin after each successful rebuild so the
 *     server can forward the signal to connected SSE clients.
 *
 * Process 2 is started with --dev-worker so it:
 *   - Serves GET /__dev/events  (SSE reload endpoint)
 *   - Reads stdin and calls DevReloadServer.broadcast('reload') on each `reload` line
 */
export class DevOrchestrator {
  // Paths whose changes trigger a full server restart
  private static readonly BACKEND = [
    "app/",
    "routes/",
    "bootstrap/",
    "config/",
    "packages/",
    "resources/app.html",
  ];

  // Paths whose changes trigger a frontend rebuild only
  private static readonly FRONTEND = ["resources/pages/", "resources/js/", "resources/css/"];

  // Always-ignored output / tool directories
  private static readonly IGNORE = ["public/", ".zerotal/", "node_modules/", ".git/"];

  // pages.generated.ts is written BY the build — ignore its own change event
  private static readonly IGNORE_FILES = new Set(["resources/js/pages.generated.ts"]);

  private _child: ReturnType<typeof Bun.spawn> | null = null;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _buildTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Serializes restarts. The debounce timer only spaces out the *scheduling* of a
   * restart — once its callback starts it clears the timer and then awaits a rebuild
   * that can take seconds, during which another change schedules a second callback.
   * Both then reached `_spawnServer()`, so two servers raced for the port, one lost
   * with "Failed to start server. Is port 3000 in use?", and the dev server was left
   * dead while the winner kept serving. A restart requested while one is running now
   * queues a single follow-up instead of running in parallel.
   */
  private _restartInFlight: Promise<void> | null = null;
  private _restartQueued = false;

  /**
   * Bounded respawn attempts. The race above is fixed at the source, but a port can
   * still be briefly unavailable after the previous owner exits — the OS releases the
   * listening socket asynchronously — so a lost bind retries rather than killing dev mode.
   */
  private static readonly RESPAWN_ATTEMPTS = 3;
  private static readonly RESPAWN_DELAY_MS = 300;
  /** A server that binds stays up; one that loses the port exits almost immediately. */
  private static readonly BIND_SETTLE_MS = 400;
  /** Per-build asset-version token — bumped on each build, busts `asset()` `?v=` URLs. */
  private _assetVersion = Date.now().toString(36);

  constructor(
    private readonly _port: number,
    private readonly _cwd: string,
    private readonly _build: BuildHookFn,
    private readonly _hooks: DevOrchestratorHooks = {},
  ) {}

  async start(): Promise<void> {
    this._say("  [zerotal:dev] ⚙  building assets...");
    const started = Bun.nanoseconds();
    const build = await this._runBuild();

    if (!build.ok) {
      this._say("  [zerotal:dev] ⚠  initial build failed — starting server anyway", "warn");
    } else if (build.skipped) {
      // Said out loud on purpose. A boot that prints "building assets…" and then
      // nothing looks like a hang, and a developer who cannot tell a skip from a
      // stall deletes `.zerotal/` and stops trusting the cache.
      this._say(`  [zerotal:dev] ✓  assets unchanged — reused the last build (${_ms(started)})`);
    }

    // Same retry as a restart: the commonest reason the first bind fails is an orphaned
    // server from a previous run that has not finished exiting.
    await this._spawnServerWithRetry();

    // Only now are `after: "server"` processes started — a process that talks to
    // the server would otherwise spend its first attempts against a closed port
    // and burn its restart budget before the server ever bound.
    await this._hooks.onServerReady?.();

    this._watch();

    // Park the process — cleanup happens in signal handlers registered by _watch()
    await new Promise<never>(() => {});
  }

  /** Narrate, through the deck when one is present and the console otherwise. */
  private _say(text: string, level: "info" | "warn" | "error" = "info"): void {
    if (this._hooks.onNotice) {
      this._hooks.onNotice(text, level);
      return;
    }
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
  }

  // ── Server management ──────────────────────────────────────────────────────

  private _spawnServer(): ReturnType<typeof Bun.spawn> {
    // Piped only when something is listening. Left inherited otherwise, so the
    // server writes straight to the terminal exactly as it always has — routing
    // it through a hook that discards would be how dev mode goes silent.
    const routed = this._hooks.onServerLine !== undefined;
    this._hooks.onServerState?.("starting");

    const child = Bun.spawn(
      ["bun", Bun.main, "serve", "--port", String(this._port), "--dev-worker"],
      {
        stdin: "pipe",
        stdout: routed ? "pipe" : "inherit",
        stderr: routed ? "pipe" : "inherit",
        cwd: this._cwd,
        env: {
          ...Bun.env,
          APP_ENV: "web",
          // Mark the worker as developer-supervised. APP_ENV above is the
          // runtime mode, not a deployment name, so it cannot carry this —
          // without the flag the worker looks production-like to every
          // dev-surface gate and `serve --dev` renders bare 500s with no stack.
          [DEV_WORKER_ENV_VAR]: "1",
          ZT_ASSET_VERSION: this._assetVersion,
        },
      },
    );

    this._child = child;

    if (routed) {
      void this._pipe(child.stdout as ReadableStream<Uint8Array>, "stdout");
      void this._pipe(child.stderr as ReadableStream<Uint8Array>, "stderr");
    }

    void child.exited.then((code) => {
      // Report only the *current* server dying unexpectedly. Comparing against
      // `this._child` identity matters: reading the field alone reported an exit that a
      // restart had deliberately caused, because by then the field held the replacement.
      // A restart in flight owns its own reporting.
      if (this._child === child && this._restartInFlight === null && code !== 0) {
        this._say(`  [zerotal:dev] server exited with code ${code}`);
        this._hooks.onServerState?.("parked");
      }
    });

    return child;
  }

  /** Split the server child's piped output into lines and hand them to the deck. */
  private async _pipe(
    stream: ReadableStream<Uint8Array> | null,
    kind: "stdout" | "stderr",
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) this._hooks.onServerLine?.(line.replace(/\r$/, ""), kind);
      }
    } catch {
      // The stream ends when the server is replaced — the normal case on every
      // restart, not something to report.
    }

    if (buffered) this._hooks.onServerLine?.(buffered, kind);
  }

  /**
   * Restart the server on request — the deck's `r` key on the server tab.
   *
   * Goes through the same path a file change takes, so it rebuilds assets first
   * and folds into a restart already running rather than racing it for the port.
   */
  restartServer(): Promise<void> {
    return this._requestRestart();
  }

  private _scheduleRestart(): void {
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      void this._requestRestart();
    }, 150);
  }

  /**
   * Run a restart, or fold this request into the one already running.
   *
   * Restarts must not overlap: each one kills the current server and binds a new one to
   * the same port, so two in flight means two servers competing for it. A request that
   * arrives mid-restart sets a flag instead, and exactly one more restart runs when the
   * current one finishes — enough to pick up whatever changed, without a queue that
   * grows one entry per keystroke.
   */
  private _requestRestart(): Promise<void> {
    if (this._restartInFlight) {
      this._restartQueued = true;
      return this._restartInFlight;
    }

    const run = async (): Promise<void> => {
      try {
        do {
          this._restartQueued = false;
          await this._restartOnce();
        } while (this._restartQueued);
      } finally {
        this._restartInFlight = null;
      }
    };

    this._restartInFlight = run();
    return this._restartInFlight;
  }

  private async _restartOnce(): Promise<void> {
    this._say("  [zerotal:dev] ↻  backend change — rebuilding + restarting server...");
    this._hooks.onServerState?.("restarting");

    // Rebuild assets before respawning: server-rendered views (Flow pages in `app/`,
    // controllers returning markup) contain Tailwind classes the stylesheet scans via
    // `@source`, so a backend edit can introduce new classes. Without this, a new utility
    // used in a page wouldn't appear until an unrelated `resources/` file changed. The
    // fresh `_assetVersion` (bumped by _runBuild) is passed to the respawned worker, so the
    // browser refetches the updated CSS.
    await this._runBuild();

    // Stop before spawning, always: the old server owns the port until it exits.
    await this._stopChild();
    await this._spawnServerWithRetry();
  }

  /** Stop the running server and wait for it to actually exit, releasing the port. */
  private async _stopChild(): Promise<void> {
    const child = this._child;
    this._child = null;
    if (!child) return;

    child.kill("SIGTERM");
    const forceKill = setTimeout(() => child.kill("SIGKILL"), 1_500);
    try {
      await child.exited;
    } finally {
      clearTimeout(forceKill);
    }
  }

  /**
   * Spawn the server, retrying briefly if it dies on startup.
   *
   * A bind failure is indistinguishable from an application crash by exit code alone, so
   * this retries either — a crash simply fails the remaining attempts quickly and reports.
   * Leaving dev mode with no server and no explanation is the worse outcome: the watcher
   * stays alive, so the next save appears to do nothing while the browser talks to
   * whatever is still listening.
   */
  private async _spawnServerWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= DevOrchestrator.RESPAWN_ATTEMPTS; attempt++) {
      const child = this._spawnServer();

      const settled = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(DevOrchestrator.BIND_SETTLE_MS).then(() => false),
      ]);

      if (!settled) {
        this._hooks.onServerState?.("running"); // still running → it bound the port
        return;
      }
      if (this._child !== child) return; // superseded by a newer restart

      this._child = null;
      if (attempt < DevOrchestrator.RESPAWN_ATTEMPTS) {
        await Bun.sleep(DevOrchestrator.RESPAWN_DELAY_MS);
      }
    }

    this._hooks.onServerState?.("parked");
    this._say(
      `  [zerotal:dev] ✗  server did not start after ${DevOrchestrator.RESPAWN_ATTEMPTS} attempts.\n` +
        `     Port ${this._port} may be held by another process — the error above says which.\n` +
        `     Dev mode is still watching; fix the cause and save to retry.`,
      "error",
    );
  }

  // ── Build management ───────────────────────────────────────────────────────

  private _scheduleBuild(path: string): void {
    if (this._buildTimer) clearTimeout(this._buildTimer);
    this._buildTimer = setTimeout(async () => {
      this._buildTimer = null;
      const label = path.startsWith("resources/pages/") ? "page" : "asset";
      this._say(`  [zerotal:dev] ⚙  ${label} changed — rebuilding...`);

      const build = await this._runBuild();
      if (build.ok) {
        // Still reload on a skip: the change that triggered this may have been
        // to a file the bundles do not contain (a server-rendered template),
        // and the browser has no other way to learn about it.
        this._say(
          build.skipped
            ? "  [zerotal:dev] ✓  bundles unchanged — reloading browser"
            : "  [zerotal:dev] ✓  ready — reloading browser",
        );
        this._signalReload();
      }
    }, 80);
  }

  private async _runBuild(): Promise<{ ok: boolean; skipped: boolean }> {
    try {
      const result = await this._build();
      if (!result.success) {
        this._say("  [zerotal:dev] ✗  build failed:", "error");
        for (const entry of result.logs ?? []) {
          this._say(`     ${String(entry)}`, "error");
        }
        return { ok: false, skipped: false };
      }

      // A skipped build wrote nothing, so the files the browser already holds
      // are still current — bumping the token would force a pointless refetch
      // of every asset on the page.
      if (result.skipped !== true) this._assetVersion = Date.now().toString(36);

      return { ok: true, skipped: result.skipped === true };
    } catch (error) {
      this._say(`  [zerotal:dev] ✗  build error: ${String(error)}`, "error");
      return { ok: false, skipped: false };
    }
  }

  private _signalReload(): void {
    try {
      // When spawned with `stdin: "pipe"` this is a FileSink (not a numeric fd).
      // Carry the fresh asset-version token so the worker can update `asset()`
      // URLs before broadcasting the browser reload.
      const sink = this._child?.stdin as import("bun").FileSink | undefined;
      sink?.write(`reload:${this._assetVersion}\n`);
      sink?.flush?.();
    } catch {
      // Child may be in mid-restart — ignore
    }
  }

  // ── File watcher ───────────────────────────────────────────────────────────

  private _watch(): void {
    const watcher = watch(this._cwd, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      // Normalise to forward slashes (Windows reports backslashes).
      const relativePath = filename.replace(/\\/g, "/");

      // Skip hidden dirs, ignored dirs, and generated files.
      if (relativePath.startsWith(".")) return;
      if (DevOrchestrator.IGNORE.some((prefix) => relativePath.startsWith(prefix))) return;
      if (DevOrchestrator.IGNORE_FILES.has(relativePath)) return;

      if (
        DevOrchestrator.BACKEND.some(
          (prefix) => relativePath.startsWith(prefix) || relativePath === prefix.replace(/\/$/, ""),
        )
      ) {
        this._scheduleRestart();
      } else if (DevOrchestrator.FRONTEND.some((prefix) => relativePath.startsWith(prefix))) {
        this._scheduleBuild(relativePath);
      }
    });

    process.on("SIGTERM", () => void this.shutdown(watcher));
    process.on("SIGINT", () => void this.shutdown(watcher));
  }

  /**
   * Stop everything dev mode owns, then exit.
   *
   * `onCleanup` runs *before* the exit and is awaited, because it is what stops
   * the supervised processes and hands the terminal back. Exiting first would
   * leave orphaned children and a shell in raw mode — the bug this ordering
   * exists to prevent.
   */
  async shutdown(watcher?: { close(): void }): Promise<never> {
    watcher?.close();
    try {
      await this._hooks.onCleanup?.();
    } catch {
      // A failing cleanup must not stop the rest of the shutdown; whatever it
      // could not release, exiting releases anyway.
    }
    this._child?.kill("SIGTERM");
    process.exit(0);
  }
}

/** Elapsed time since a `Bun.nanoseconds()` reading, as `"12ms"`. */
function _ms(since: number): string {
  return `${Math.round((Bun.nanoseconds() - since) / 1e6)}ms`;
}
