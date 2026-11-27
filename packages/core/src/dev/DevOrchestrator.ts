/**
 * The supervisor process for dev mode: it builds assets, spawns the Zerotal
 * server as a child, watches the filesystem, and restarts or rebuilds on change.
 */
import { watch } from "node:fs";
import type { BuildHookFn } from "./DevBuildHook.ts";
import { DEV_WORKER_ENV_VAR } from "../support/env.ts";
import { requestGracefulStop } from "./devShutdown.ts";
import { ZEROTAL_VERSION, installedCoreVersion } from "../support/version.ts";
import { _DEV_RELOAD_SCRIPT_PATH, _DEV_RELOAD_SOURCE } from "./reloadClient.ts";
import { _classifyChange } from "./devChanges.ts";

/**
 * How the orchestrator reports to whatever is presenting dev mode.
 *
 * All optional, and all defaulting to the console. Without them the orchestrator
 * behaves exactly as it did before the deck existed — which is what keeps the
 * plain `bun --watch` path and the existing tests honest.
 *
 * @internal
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
  /**
   * Called each time the server restarts, for a file change or the deck's `r`
   * key, before the new server is spawned. Not called for the first start.
   *
   * `processes` says whether the processes that restart with the server should
   * restart too. It is `false` when every change behind the restart is to a file
   * only the server loads, such as a Flow page under `app/flow/`.
   */
  onServerRestart?: (restart: { processes: boolean }) => void;
  /** Called on SIGINT/SIGTERM, before the process exits. */
  onCleanup?: () => void | Promise<void>;
}

/**
 * Dev Orchestrator — Process 1 of the two-process dev mode.
 *
 * Responsibilities:
 *   - Runs an initial pages-manifest sync + asset build before the server starts.
 *   - Spawns the Zerotal server (Process 2) as a child process with stdin piped.
 *   - Watches the filesystem and, by `_classifyChange()`:
 *       • Backend change  → debounced server restart (150 ms), with the processes
 *                           that restart with it
 *       • View change     → the same restart, without those processes (`app/flow/`)
 *       • Frontend change → debounced asset rebuild + browser reload signal (80 ms)
 *   - Writes `reload\n` to the child's stdin after each successful rebuild so the
 *     server can forward the signal to connected SSE clients.
 *
 * Process 2 is started with --dev-worker so it:
 *   - Serves GET /__dev/events  (SSE reload endpoint)
 *   - Reads stdin and calls DevReloadServer.broadcast('reload') on each `reload` line
 */
export class DevOrchestrator {
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
  /** The installed version already warned about, so one upgrade warns once. */
  private _warnedVersion: string | null = null;
  private _restartQueued = false;
  /**
   * Whether a restart that has not run yet must also restart the processes that
   * restart with the server. Set by a backend change and by the deck's `r` key, left
   * unset by a change only the server loads, and read once by the restart that runs.
   */
  private _processesDue = false;

  /**
   * Bounded respawn attempts. The race above is fixed at the source, but a port can
   * still be briefly unavailable after the previous owner exits — the OS releases the
   * listening socket asynchronously — so a lost bind retries rather than killing dev mode.
   */
  private static readonly RESPAWN_ATTEMPTS = 3;
  private static readonly RESPAWN_DELAY_MS = 300;
  /** A server that binds stays up; one that loses the port exits almost immediately. */
  private static readonly BIND_SETTLE_MS = 400;
  /**
   * What the last build said when it failed, or `null` after a good one. Sent to the worker,
   * which shows it in the browser, and sent again to each new worker, since a restart starts
   * one that knows nothing about it.
   */
  private _buildFailure: string[] | null = null;
  /**
   * The last lines the current server wrote. When it will not start, they say why: a syntax
   * error in a page and a port held by another process look alike by exit code alone.
   */
  private _serverOutput: string[] = [];
  /** Set while a start is being attempted, which reports its own failure. */
  private _starting = false;
  /**
   * What answers on the port while the server is down: a page saying why, which reloads
   * itself once the server is back, instead of the browser's "connection refused".
   */
  private _fallback: { stop(closeActive?: boolean): Promise<void> | void } | null = null;
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
    this._serverOutput = [];

    const child = Bun.spawn(
      ["bun", Bun.main, "serve", "--port", String(this._port), "--dev-worker"],
      {
        stdin: "pipe",
        stdout: routed ? "pipe" : "inherit",
        stderr: routed ? "pipe" : "inherit",
        // Opens the channel `_stopChild` asks over. Nothing is sent the other
        // way, but Bun only gives the parent a `send` when a handler is present.
        ipc: () => {},
        cwd: this._cwd,
        env: {
          ...Bun.env,
          APP_TYPE: "web",
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
      if (
        this._child === child &&
        this._restartInFlight === null &&
        !this._starting &&
        code !== 0
      ) {
        this._say(`  [zerotal:dev] server exited with code ${code}`);
        this._hooks.onServerState?.("parked");
        void this._serveStartupError(_startupFailure(this._serverOutput));
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
        for (const line of lines) this._serverLine(line.replace(/\r$/, ""), kind);
      }
    } catch {
      // The stream ends when the server is replaced — the normal case on every
      // restart, not something to report.
    }

    if (buffered) this._serverLine(buffered, kind);
  }

  /** Hand a server line to the deck, and keep it in case the server is about to die. */
  private _serverLine(line: string, kind: "stdout" | "stderr"): void {
    this._serverOutput.push(line.replace(_ANSI, ""));
    if (this._serverOutput.length > 200) this._serverOutput.shift();
    this._hooks.onServerLine?.(line, kind);
  }

  /**
   * Restart the server on request — the deck's `r` key on the server tab.
   *
   * Goes through the same path a file change takes, so it rebuilds assets first
   * and folds into a restart already running rather than racing it for the port.
   */
  restartServer(): Promise<void> {
    this._processesDue = true;
    return this._requestRestart();
  }

  /**
   * Restart after a burst of saves settles.
   *
   * `processes` accumulates over the burst: a page saved together with a schedule
   * restarts the scheduler too.
   */
  private _scheduleRestart(processes: boolean): void {
    if (processes) this._processesDue = true;
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
    // Taken now, so a change that lands during this restart queues the next one with
    // its own answer.
    const processes = this._processesDue;
    this._processesDue = false;
    this._say(
      processes
        ? "  [zerotal:dev] ↻  backend change — rebuilding + restarting server..."
        : "  [zerotal:dev] ↻  view change — rebuilding + restarting the server only...",
    );
    this._hooks.onServerState?.("restarting");

    this._warnIfFrameworkUpgradedUnderneath();

    // Processes that load the app's own files restart with the server, so a
    // schedule edited under `app/` is not left running its old code. A change only
    // the server loads (a Flow page) leaves them running: restarting a scheduler
    // boots the whole app again, for a file it never reads.
    this._hooks.onServerRestart?.({ processes });

    // Rebuild assets before respawning: server-rendered views (Flow pages in `app/`,
    // controllers returning markup) contain Tailwind classes the stylesheet scans via
    // `@source`, so a backend edit can introduce new classes. Without this, a new utility
    // used in a page wouldn't appear until an unrelated `resources/` file changed. The
    // fresh `_assetVersion` (bumped by _runBuild) is passed to the respawned worker, so the
    // browser refetches the updated CSS.
    //
    // The old server stops while the build runs rather than after it. It is about to be
    // replaced either way, and the two waits overlapping takes the shorter one off every
    // save. A build failure still reaches the new server, which is told on start.
    //
    // Stop before spawning, always: the old server owns the port until it exits.
    await Promise.all([this._runBuild(), this._stopChild()]);
    await this._spawnServerWithRetry();
  }

  /**
   * Say so when the framework on disk is no longer the framework running.
   *
   * A `bun add zerotal@latest` in another terminal changes `node_modules` and
   * nothing else: this process holds the code it imported at boot, and a restart
   * only re-executes the *app* against that same in-memory framework. So the
   * upgrade appears to have no effect — the fix is installed, the symptom
   * persists, and the obvious conclusion is that the fix does not work.
   *
   * Checked on restart rather than at boot, because that is when it can have
   * become true, and warned once per version so a long session is not nagged.
   */
  private _warnIfFrameworkUpgradedUnderneath(): void {
    const onDisk = installedCoreVersion(this._cwd);
    if (onDisk === null || onDisk === ZEROTAL_VERSION || onDisk === this._warnedVersion) return;

    this._warnedVersion = onDisk;
    this._say(
      `  [zerotal:dev] ⚠  framework upgraded on disk: running v${ZEROTAL_VERSION}, installed v${onDisk}`,
      "warn",
    );
    this._say("  [zerotal:dev]    restart the dev server to pick it up (a save will not).", "warn");
  }

  /** Stop the running server and wait for it to actually exit, releasing the port. */
  private async _stopChild(): Promise<void> {
    const child = this._child;
    this._child = null;
    if (!child) return;

    // Ask first. On Windows a signal cannot reach the worker at all — it is
    // terminated where it stands, with open responses left half-written — and
    // asking is the only way it ever drains its providers. See devShutdown.ts.
    if (await requestGracefulStop(child)) return;

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
    // The error page holds the port while the server is down; hand it back first.
    await this._stopFallback();
    this._starting = true;
    let failure: StartupFailure = { kind: "unknown", lines: [] };
    try {
      for (let attempt = 1; attempt <= DevOrchestrator.RESPAWN_ATTEMPTS; attempt++) {
        const child = this._spawnServer();

        const settled = await Promise.race([
          child.exited.then(() => true),
          Bun.sleep(DevOrchestrator.BIND_SETTLE_MS).then(() => false),
        ]);

        if (!settled) {
          this._hooks.onServerState?.("running"); // still running → it bound the port
          if (this._buildFailure) {
            this._tellServer(`build-error:${JSON.stringify(this._buildFailure)}`);
          }
          return;
        }
        if (this._child !== child) return; // superseded by a newer restart

        this._child = null;
        // Let the last of its output arrive before reading it.
        await Bun.sleep(20);
        failure = _startupFailure(this._serverOutput);
        // A syntax error fails the same way every time: retrying it only repeats the error
        // three times and then blames the port. Retries are for a port the previous server
        // has not released yet.
        if (failure.kind === "source") break;
        if (attempt < DevOrchestrator.RESPAWN_ATTEMPTS) {
          await Bun.sleep(DevOrchestrator.RESPAWN_DELAY_MS);
        }
      }
    } finally {
      this._starting = false;
    }

    this._hooks.onServerState?.("parked");
    if (failure.kind === "source") {
      this._say(
        `  [zerotal:dev] ✗  server did not start: ${failure.lines[0]}\n` +
          `     Fix it and save; the browser shows this error until the server is back.`,
        "error",
      );
    } else if (failure.kind === "port") {
      this._say(
        `  [zerotal:dev] ✗  server did not start after ${DevOrchestrator.RESPAWN_ATTEMPTS} attempts.\n` +
          `     Port ${this._port} is held by another process — the error above says which.\n` +
          `     Dev mode is still watching; fix the cause and save to retry.`,
        "error",
      );
    } else {
      this._say(
        `  [zerotal:dev] ✗  server did not start after ${DevOrchestrator.RESPAWN_ATTEMPTS} attempts.\n` +
          `     The error above says why${failure.lines.length === 0 ? ` (or port ${this._port} may be held by another process)` : ""}.\n` +
          `     Dev mode is still watching; fix the cause and save to retry.`,
        "error",
      );
    }
    // Not for a port someone else holds: there is nothing to serve on.
    if (failure.kind !== "port") await this._serveStartupError(failure);
  }

  /**
   * Answer on the port, while the server is down, with why it is down.
   *
   * A Flow page with a syntax error stops the server (the page is imported at boot), and the
   * browser got "connection refused" — nothing to say what, or that a save would fix it. This
   * page says what, and loads `/__dev/reload.js`, whose socket reconnects to the real server
   * when it is back and reloads the tab.
   */
  private async _serveStartupError(failure: StartupFailure): Promise<void> {
    await this._stopFallback();
    const detail =
      failure.lines.length > 0
        ? failure.lines
        : ["The server exited while starting. Its output in the terminal says why."];
    const page = _startupErrorPage(detail);
    // A token no real build has, so the tab reloads when the real server answers.
    const version = `server-down-${Date.now().toString(36)}`;
    try {
      this._fallback = Bun.serve({
        port: this._port,
        fetch(req, server) {
          const path = new URL(req.url).pathname;
          if (path === "/__dev/ws" && server.upgrade(req)) return undefined;
          if (path === _DEV_RELOAD_SCRIPT_PATH) {
            return new Response(_DEV_RELOAD_SOURCE, {
              headers: {
                "content-type": "text/javascript; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          }
          return new Response(page, {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          });
        },
        websocket: {
          open(ws) {
            ws.send(`version:${version}`);
          },
          message() {},
        },
      });
    } catch {
      // Something else holds the port; the terminal has said what failed.
      this._fallback = null;
    }
  }

  private async _stopFallback(): Promise<void> {
    const fallback = this._fallback;
    this._fallback = null;
    if (fallback) await fallback.stop(true);
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
        const lines = (result.logs ?? []).map((entry) => String(entry));
        for (const line of lines) this._say(`     ${line}`, "error");
        this._failBuild(lines.length > 0 ? lines : ["The frontend build failed."]);
        return { ok: false, skipped: false };
      }

      // A skipped build wrote nothing, so the files the browser already holds
      // are still current — bumping the token would force a pointless refetch
      // of every asset on the page.
      if (result.skipped !== true) this._assetVersion = Date.now().toString(36);

      if (this._buildFailure) {
        this._buildFailure = null;
        this._tellServer("build-ok");
      }
      return { ok: true, skipped: result.skipped === true };
    } catch (error) {
      this._say(`  [zerotal:dev] ✗  build error: ${String(error)}`, "error");
      this._failBuild([String(error)]);
      return { ok: false, skipped: false };
    }
  }

  /**
   * Remember a failed build and show it in the browser.
   *
   * The server goes on serving the last bundle that built, which is what keeps the page usable,
   * and was the trouble: a developer who broke a page and reloaded saw the old page, with the
   * error only in a terminal they were not looking at.
   */
  private _failBuild(lines: string[]): void {
    this._buildFailure = lines.map((line) => line.replace(_ANSI, ""));
    this._tellServer(`build-error:${JSON.stringify(this._buildFailure)}`);
  }

  private _signalReload(): void {
    // Carry the fresh asset-version token so the worker can update `asset()`
    // URLs before broadcasting the browser reload.
    this._tellServer(`reload:${this._assetVersion}`);
  }

  /** One line to the worker over its stdin, which it reads in `serve --dev-worker`. */
  private _tellServer(line: string): void {
    try {
      // When spawned with `stdin: "pipe"` this is a FileSink (not a numeric fd).
      const sink = this._child?.stdin as import("bun").FileSink | undefined;
      sink?.write(`${line}\n`);
      sink?.flush?.();
    } catch {
      // Child may be in mid-restart — the next one is told when it starts.
    }
  }

  // ── File watcher ───────────────────────────────────────────────────────────

  private _watch(): void {
    const watcher = watch(this._cwd, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      // Normalise to forward slashes (Windows reports backslashes).
      const relativePath = filename.replace(/\\/g, "/");

      // The watch list, and what each path restarts, is in devChanges.ts.
      const change = _classifyChange(relativePath);
      if (change === "restart-all") this._scheduleRestart(true);
      else if (change === "restart-server") this._scheduleRestart(false);
      else if (change === "rebuild") this._scheduleBuild(relativePath);
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
    await this._stopFallback().catch(() => {});
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

/** Why a server would not start, as read from what it wrote. */
interface StartupFailure {
  /**
   * `source`: an error in the app's code, at a file and line — the same on every attempt.
   * `port`: the port is taken. `unknown`: neither could be read from the output.
   */
  kind: "source" | "port" | "unknown";
  /** `file:line:column message` first, for a source error; the error's own lines otherwise. */
  lines: string[];
}

/**
 * Read why a server would not start from its last lines of output.
 *
 * Bun prints a parse error as `error: <message>` and, below it, `at <file>:<line>:<column>`;
 * an uncaught error as `TypeError: <message>` with a stack of `at …` lines.
 *
 * @internal Exported for tests.
 */
export function _startupFailure(output: readonly string[]): StartupFailure {
  const text = output.join("\n");
  if (
    /EADDRINUSE|address already in use|port \d+ (?:is )?(?:already )?in use|Is port \d+ in use/i.test(
      text,
    )
  ) {
    return { kind: "port", lines: output.filter((line) => /port|EADDRINUSE|address/i.test(line)) };
  }
  const index = output.findIndex((line) => /^\s*(?:error|\w*Error):\s/.test(line));
  if (index === -1) return { kind: "unknown", lines: output.filter(Boolean).slice(-15) };
  const message = output[index]!.trim().replace(/^error:\s*/, "");
  for (const line of output.slice(index + 1, index + 12)) {
    const at = /\bat\s+(?:.*?\()?((?:[A-Za-z]:)?[^\s():]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (at && !at[1]!.includes("node_modules")) {
      // The code frame Bun prints above the error, which shows the line itself.
      const frame = output
        .slice(Math.max(0, index - 4), index)
        .filter((l) => /^\s*\d+ \|/.test(l) || /^\s+\^/.test(l));
      return { kind: "source", lines: [`${at[1]}:${at[2]}:${at[3]} ${message}`, ...frame] };
    }
  }
  return { kind: "unknown", lines: output.slice(index, index + 15) };
}

/** The page the port answers with while the server will not start. */
function _startupErrorPage(lines: readonly string[]): string {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server did not start</title>
<style>
body{margin:0;padding:32px;background:#111117;color:#f4f4f5;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
h1{margin:0 0 4px;color:#f87171;font-size:18px}
p{margin:0 0 16px;color:#a1a1aa}
pre{margin:0;padding:16px;border-radius:6px;background:rgba(255,255,255,.06);white-space:pre-wrap;word-break:break-word}
</style>
</head>
<body>
<h1>The server did not start</h1>
<p>Fix the error and save. This page reloads by itself when the server is back.</p>
<pre>${escape(lines.join("\n"))}</pre>
<script src="${_DEV_RELOAD_SCRIPT_PATH}"></script>
</body>
</html>
`;
}

/** Terminal colour codes, which a build log can carry and a browser would print as text. */
const _ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Elapsed time since a `Bun.nanoseconds()` reading, as `"12ms"`. */
function _ms(since: number): string {
  return `${Math.round((Bun.nanoseconds() - since) / 1e6)}ms`;
}
