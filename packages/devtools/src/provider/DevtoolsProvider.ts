import {
  ServiceProvider,
  isDevSurfaceAllowed,
  type AppEnvironment,
  type HttpContext,
} from "@zerotal/core";
import { DevReloadMiddleware, registerDevHtmlSnippet } from "@zerotal/core/dev";
import {
  DevtoolsInjectionMiddleware,
  startDevtoolsStream,
} from "../DevtoolsInjectionMiddleware.ts";
import { DevtoolsConfig, type DevtoolsConfigShape } from "../config.ts";
import { TraceStore, _setTraceStore } from "../TraceStore.ts";
import {
  startDevtoolsTracing,
  stopDevtoolsTracing,
  startConsoleCapture,
  stopConsoleCapture,
  traceSink,
  _resetChannels,
  _setRedaction,
  type TraceSink,
} from "../tracing.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    "devtools.trace": TraceSink;
  }
}

const PURPLE = "\x1b[35m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Activates Zerotal DevTools for web environments.
 * No-op in production.
 *
 * Register in `bootstrap/app.ts`:
 *
 * ```typescript
 * import { DevtoolsProvider } from '@zerotal/devtools';
 *
 * Application.create()
 *   .register([DatabaseProvider, DevtoolsProvider])
 * ```
 *
 * In development the floating panel is **auto-injected** into HTML responses —
 * no `DevTools.start()` in your app bundle. (You can still import it manually
 * from `@zerotal/devtools/client` if you prefer to control startup.)
 *
 * Routes served automatically:
 *   GET  /__zerotal/devtools              standalone inspector dashboard
 *   GET  /__zerotal/devtools/client.js    injected in-page panel bundle
 *   GET  /__zerotal/devtools/sse          SSE stream (EventSource)
 *   GET  /__zerotal/devtools/api/traces   recent request traces (JSON)
 *   GET  /__zerotal/devtools/api/channels declared trace channels (JSON)
 *   POST /__zerotal/devtools/api/clear    clear trace history
 */
export class DevtoolsProvider extends ServiceProvider {
  // Deliberately empty: `devtools.trace` is only bound when the dev surface is
  // allowed (fail-closed outside development), and every token in `provides` is
  // a boot-doctor guarantee that must hold in every environment. Satellites
  // detect the sink with `tryMake`, so its absence is a supported state.
  static override provides = [] as const;
  static override environments: AppEnvironment[] = ["web"];

  /** Set once the provider has activated, so teardown only undoes what it did. */
  private _active = false;
  private _stopStream: (() => void) | null = null;

  override async onBooting(): Promise<void> {
    const env = Bun.env["APP_ENV"] ?? "";
    // Fail closed: only activate for explicitly non-prod envs. An unset or
    // `staging` APP_ENV must NOT expose the unauthenticated trace inspector.
    if (!isDevSurfaceAllowed(env)) return;
    this._active = true;

    const config = this._config();

    // The store is built here rather than at import time: opening a database
    // from module scope would create `.zerotal/devtools.sqlite` in the working
    // directory of every process that imports this package, production included.
    _setTraceStore(
      new TraceStore({
        capacity: config.capacity,
        dbPath: config.dbPath,
        pruneHours: config.pruneHours,
      }),
    );
    _setRedaction(config.redact);

    // Expose the trace sink so feature packages can contribute per-request spans
    // and declare their own channels. Bound in onBooting so it is available when
    // providers' onBooted run.
    //
    // `value`, not `singleton`: an unresolved singleton is invisible to the
    // synchronous `tryMake` every satellite bridge uses to detect devtools, so
    // registering it as a factory meant those bridges silently found nothing and
    // no package's spans ever reached the panel in a real app.
    this.app.container.value("devtools.trace", traceSink);

    this.app.useOnce(DevtoolsInjectionMiddleware as never);

    // Auto-inject the in-page panel into HTML responses via the core dev
    // injector — no `DevTools.start()` needed in the app's own bundle. Also
    // register the injector so this works under a plain `serve` (not only
    // `serve --dev-worker`, where Application.enableDevWs() already adds it).
    this.app.useOnce(DevReloadMiddleware as never);
    registerDevHtmlSnippet("zerotal-devtools", (ctx: HttpContext) =>
      ctx.url.pathname.startsWith("/__zerotal")
        ? "" // don't inject the panel into the devtools' own pages
        : `<script type="module" src="/__zerotal/devtools/client.js"></script>`,
    );
  }

  override async onBooted(): Promise<void> {
    if (!this._active) return;

    // N+1 detection is owned by the ORM provider now (env-gated there), so
    // devtools no longer imports @zerotal/orm — it only consumes FrameworkEvents.
    startDevtoolsTracing();
    startConsoleCapture();
    this._stopStream = startDevtoolsStream();

    process.stdout.write(
      `  ${PURPLE}[Zerotal Inspector]${RESET} DevTools active\n` +
        `  ${DIM}Panel${RESET}     → auto-injected into dev pages\n` +
        `  ${DIM}Dashboard${RESET} → ${CYAN}/__zerotal/devtools${RESET}\n`,
    );
  }

  async onStopping(): Promise<void> {
    if (!this._active) return;
    stopDevtoolsTracing();
    stopConsoleCapture();
    this._stopStream?.();
    this._stopStream = null;
    _resetChannels();
    // Flushes any pending batch and closes the database — without this a suite
    // that boots several apps leaves a handle and an hourly timer per app.
    _setTraceStore(null);
    this._active = false;
  }

  /** The app's `devtools` config, falling back to defaults when none is present. */
  private _config(): DevtoolsConfigShape {
    const config = this.app.container.tryMake("config");
    const raw = config?.get<Partial<DevtoolsConfigShape>>("devtools");
    return DevtoolsConfig(raw ?? {});
  }
}
