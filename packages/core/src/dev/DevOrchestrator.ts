/**
 * The supervisor process for dev mode: it builds assets, spawns the Zerotal
 * server as a child, watches the filesystem, and restarts or rebuilds on change.
 */
import { watch } from "node:fs";
import type { BuildHookFn } from "./DevBuildHook.ts";
import { DEV_WORKER_ENV_VAR } from "../support/env.ts";

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
  /** Per-build asset-version token — bumped on each build, busts `asset()` `?v=` URLs. */
  private _assetVersion = Date.now().toString(36);

  constructor(
    private readonly _port: number,
    private readonly _cwd: string,
    private readonly _build: BuildHookFn,
  ) {}

  async start(): Promise<void> {
    console.log("  [zerotal:dev] ⚙  building assets...");
    const buildSucceeded = await this._runBuild();
    if (!buildSucceeded) {
      console.warn("  [zerotal:dev] ⚠  initial build failed — starting server anyway");
    }

    this._spawnServer();
    this._watch();

    // Park the process — cleanup happens in signal handlers registered by _watch()
    await new Promise<never>(() => {});
  }

  // ── Server management ──────────────────────────────────────────────────────

  private _spawnServer(): void {
    this._child = Bun.spawn(
      ["bun", Bun.main, "serve", "--port", String(this._port), "--dev-worker"],
      {
        stdin: "pipe",
        stdout: "inherit",
        stderr: "inherit",
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

    this._child.exited.then((code) => {
      // Ignore expected exits (restart in progress or clean shutdown)
      if (this._child && this._restartTimer === null && code !== 0) {
        console.log(`  [zerotal:dev] server exited with code ${code}`);
      }
    });
  }

  private _scheduleRestart(): void {
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      console.log("  [zerotal:dev] ↻  backend change — rebuilding + restarting server...");

      // Rebuild assets before respawning: server-rendered views (Flow pages in `app/`,
      // controllers returning markup) contain Tailwind classes the stylesheet scans via
      // `@source`, so a backend edit can introduce new classes. Without this, a new utility
      // used in a page wouldn't appear until an unrelated `resources/` file changed. The
      // fresh `_assetVersion` (bumped by _runBuild) is passed to the respawned worker, so the
      // browser refetches the updated CSS.
      await this._runBuild();

      const previousChild = this._child;
      this._child = null;

      if (previousChild) {
        previousChild.kill("SIGTERM");
        const forceKill = setTimeout(() => previousChild.kill("SIGKILL"), 1_500);
        await previousChild.exited;
        clearTimeout(forceKill);
      }

      this._spawnServer();
    }, 150);
  }

  // ── Build management ───────────────────────────────────────────────────────

  private _scheduleBuild(path: string): void {
    if (this._buildTimer) clearTimeout(this._buildTimer);
    this._buildTimer = setTimeout(async () => {
      this._buildTimer = null;
      const label = path.startsWith("resources/pages/") ? "page" : "asset";
      console.log(`  [zerotal:dev] ⚙  ${label} changed — rebuilding...`);

      const buildSucceeded = await this._runBuild();
      if (buildSucceeded) {
        console.log("  [zerotal:dev] ✓  ready — reloading browser");
        this._signalReload();
      }
    }, 80);
  }

  private async _runBuild(): Promise<boolean> {
    try {
      const result = await this._build();
      if (!result.success) {
        console.error("  [zerotal:dev] ✗  build failed:");
        for (const entry of result.logs ?? []) {
          console.error("    ", String(entry));
        }
        return false;
      }
      // Fresh token so the next `asset()` URL changes and the browser refetches.
      this._assetVersion = Date.now().toString(36);
      return true;
    } catch (error) {
      console.error("  [zerotal:dev] ✗  build error:", error);
      return false;
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

    const cleanup = () => {
      watcher.close();
      this._child?.kill("SIGTERM");
      process.exit(0);
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
  }
}
