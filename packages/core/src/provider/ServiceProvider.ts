/**
 * The base class application authors extend to register bindings and hook into
 * the application lifecycle (boot, start, stop, and per-request phases).
 */
import type { Application } from "../application/Application.ts";
import type { ContainerBindings } from "../container/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

/** The runtime modes a provider can declare it participates in. */
export type AppEnvironment = "web" | "console" | "worker" | "test" | "repl";

/** Base class for service providers: register bindings and observe the app lifecycle. */
export abstract class ServiceProvider {
  /** Environments in which this provider is active. Defaults to all of them. */
  static environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  /**
   * Container tokens this provider registers.
   * Required when using the array form of app.defer([Provider, ...]).
   *
   * @example
   * static override provides = ['cache'] as const;
   */
  static provides?: readonly (keyof ContainerBindings)[];

  /**
   * Other providers this one needs. They are pulled into the application
   * automatically (transitively, de-duplicated) and guaranteed to boot **before**
   * this provider — so you only have to register the feature you want, not its
   * plumbing. Reference the provider classes directly:
   *
   * @example
   * static override dependsOn = [FlowProvider];
   */
  static dependsOn?: Array<new (app: Application) => ServiceProvider>;

  /**
   * Boot-order tiebreak among providers with no `dependsOn` relationship.
   * Lower boots earlier; defaults to `0`. Handy for framework-core providers
   * (e.g. `static override priority = -100`).
   */
  static priority?: number;

  constructor(protected app: Application) {}

  /** Register container bindings. Runs before any provider boots; do not resolve services here. */
  onRegister(): void {}
  /** Resolve and prepare services before the app is considered booted. */
  async onBooting(): Promise<void> {}
  /** Run once all providers have booted and every binding is available. */
  async onBooted(): Promise<void> {}
  /** Run just before the app starts accepting work (e.g. the HTTP server). */
  async onStarting(): Promise<void> {}
  /** Run once the app has started. */
  async onStarted(): Promise<void> {}
  /** Run when the app begins a graceful shutdown; release resources here. */
  async onStopping(): Promise<void> {}
  /** Run once shutdown is complete. */
  async onStopped(): Promise<void> {}

  // ── Per-request hooks ─────────────────────────────────────────────────
  // Called by the framework on every HTTP request. Override to observe or
  // mutate the lifecycle without registering middleware.

  /** Called before the middleware pipeline runs. */
  async onRequestReceived(_ctx: HttpContext): Promise<void> {}

  /** Called after the pipeline completes and ctx.response is set. */
  async onRequestProcessed(_ctx: HttpContext): Promise<void> {}

  /** Called after the response has been sent to the client. */
  async onResponseSent(_ctx: HttpContext): Promise<void> {}

  /**
   * Variables to expose in `bun zt repl`.
   * Override in any provider to make its facades available by name in the REPL session.
   *
   * @example
   * override replContext() { return { DB, Mail }; }
   */
  replContext(): Record<string, unknown> {
    return {};
  }
}
