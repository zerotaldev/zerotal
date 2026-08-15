import { ServiceProvider } from "./ServiceProvider.ts";
import type { AppEnvironment } from "./ServiceProvider.ts";
import { FrameworkEvents } from "../events/FrameworkEvents.ts";
import { deployEnv } from "../support/env.ts";
import type {
  // Application lifecycle
  AppBooted,
  // HTTP
  RequestHandled,
  RequestFailed,
} from "../events/FrameworkEvents.ts";

import type { LoggingConfigShape } from "../logger/types.ts";
import { LoggingConfig } from "../logger/config.ts";
import { LogManager } from "../logger/LogManager.ts";
import { LoggerMiddleware } from "../logger/LoggerMiddleware.ts";

/**
 * What an app without a `config/logging.ts` gets. Deliberately the same as
 * {@link LoggingConfig}'s own defaults rather than a second, thinner set — an
 * app that never publishes the config file still gets the file trail, which is
 * the whole point of the trail being on by default.
 */
function _defaultConfig(): LoggingConfigShape {
  return LoggingConfig();
}

/** Casts the opaque ctx object to extract HTTP-readable fields. */
function _ctx(raw: object) {
  return raw as {
    response?: { status?: number };
    request?: { method?: string };
    url?: { pathname?: string };
  };
}

/**
 * Service provider that wires logging into the application.
 *
 * Registers the `log` binding (a {@link LogManager} built from the `logging`
 * config, enriched with the app name and environment), installs the
 * {@link LoggerMiddleware} for per-request access logs (unless
 * `logging.requests` is `false`), and subscribes to the core lifecycle events
 * (`AppBooted`, and 4xx/5xx `RequestHandled` / `RequestFailed`) to route them
 * through the logger. Subscriptions are torn down on stop.
 *
 * Feature packages log their own activity (slow queries, job/mail/scheduler
 * failures, the auth audit trail) through their own bridge, which resolves the
 * `log` binding when logging is installed — so the logger knows nothing about them.
 *
 * @category Logging
 */
export class LogProvider extends ServiceProvider {
  static override provides = ["log"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  private _unsubs: Array<() => void> = [];

  override onRegister(): void {
    this.app.container.singleton("log", async (c) => {
      const cfg = (await c.make("config")) as { get<T>(path: string): T | undefined };
      const logging = cfg.get<LoggingConfigShape>("logging") ?? _defaultConfig();
      const appName = cfg.get<string>("app.name");
      const appEnv = cfg.get<string>("app.env") ?? deployEnv();

      return new LogManager(logging, { app: appName, env: appEnv });
    });
  }

  override async onBooting(): Promise<void> {
    const log = (await this.app.container.make("log")) as LogManager;
    LoggerMiddleware.setManager(log);

    // Per-request access logging is on by default; `logging.requests: false` opts out.
    const cfg = (await this.app.container.make("config")) as {
      get<T>(path: string): T | undefined;
    };
    const requests = cfg.get<LoggingConfigShape>("logging")?.requests ?? true;
    if (requests) this.app.useOnce(LoggerMiddleware);
  }

  override async onBooted(): Promise<void> {
    const manager = (await this.app.container.make("log")) as LogManager;
    // Framework events carry a scope so a boot log reads as columns rather than
    // a wall of prose: [APP] for lifecycle, [HTTP] for the request pipeline.
    const appLog = manager.scope("app");
    const log = manager.scope("http");

    this._unsubs.push(
      // ── Application lifecycle ──────────────────────────────────────────────────

      FrameworkEvents.on<AppBooted>("AppBooted", (e) => {
        appLog.info("Application booted", {
          durationMs: Math.round(e.durationMs),
          environment: e.environment,
          providers: e.providerCount,
        });
      }),

      // ── HTTP ─────────────────────────────────────────────────────────────────

      FrameworkEvents.on<RequestHandled>("RequestHandled", (e) => {
        const c = _ctx(e.ctx);
        const path = c.url?.pathname ?? "?";
        if (
          path.startsWith("/__zerotal/") ||
          path.startsWith("/__flow/") ||
          path.startsWith("/__dev/")
        )
          return;
        const status = c.response?.status ?? 0;
        const ctx = { method: c.request?.method ?? "?", path, status, durationMs: e.durationMs };
        if (status >= 500) log.error("Request error", ctx);
        else if (status >= 400) log.warn("Request warning", ctx);
      }),

      FrameworkEvents.on<RequestFailed>("RequestFailed", (e) => {
        const c = _ctx(e.ctx);
        log.error(
          "Request pipeline error",
          {
            method: c.request?.method ?? "?",
            path: c.url?.pathname ?? "?",
            status: e.status,
            durationMs: e.durationMs,
          },
          new Error(e.error),
        );
      }),
    );
  }

  override onStopping(): Promise<void> {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    return Promise.resolve();
  }
}
