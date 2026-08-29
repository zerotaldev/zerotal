import type { NextFn } from "@zerotal/core";
import { SessionDriverMissingError } from "./errors.ts";
import { HttpContext, BaseMiddleware, deepMerge } from "@zerotal/core";
import { SessionManager } from "./SessionManager.ts";
import type { SessionDriver } from "./drivers/CookieDriver.ts";

export interface SessionOptions {
  /** Session driver to use. Resolved from the container when omitted. */
  driver?: SessionDriver | undefined;
}

/**
 * Session middleware — boots the session for every request.
 *
 * Loads session data from the driver into a fresh {@link SessionManager} and
 * attaches it as `ctx.session` before calling `next()`, then persists the
 * session (with any mutations) once the final response exists — registered via
 * {@link HttpContext.onResponseReady}, so it lands on a response rendered by the
 * exception handler just as it does on a successful one. IDs replaced by
 * {@link SessionManager.regenerate} are also destroyed server-side here.
 *
 * @remarks
 * Two usage patterns:
 *
 * **Config-driven (recommended)** — {@link SessionProvider} registers the
 * driver from `config/session.ts`; the middleware resolves it lazily from the
 * container on the first request.
 *
 * ```ts
 * app.use([SessionMiddleware]);
 * ```
 *
 * **Explicit driver** — useful in tests or when you don't use SessionProvider:
 *
 * ```ts
 * app.use([SessionMiddleware.withDriver(new CookieDriver(secret))]);
 * ```
 *
 * @throws {@link SessionDriverMissingError} on the first request when no driver
 * was supplied and none is registered in the container.
 */
export class SessionMiddleware extends BaseMiddleware<SessionOptions> {
  protected options: SessionOptions = {};

  constructor(driver?: SessionDriver) {
    super();
    if (driver) this.options = deepMerge(this.options, { driver });
  }

  /**
   * Build a zero-arg subclass with the given driver baked in, usable directly
   * in `app.use([...])` without an anonymous class wrapper.
   *
   * @param driver - The session driver the returned middleware will use.
   * @returns A constructable middleware class pre-bound to `driver`.
   *
   * @example
   * ```ts
   * app.use([SessionMiddleware.withDriver(new CookieDriver(secret))]);
   * ```
   */
  static withDriver(driver: SessionDriver): new () => SessionMiddleware {
    return SessionMiddleware.with({ driver }) as new () => SessionMiddleware;
  }

  /**
   * @internal Middleware entry point. Resolves the driver (if not preset), loads
   * the session onto `ctx.session`, runs {@link _afterLoad}, invokes the rest of
   * the pipeline, then saves the session and destroys any regenerated IDs.
   * @throws {@link SessionDriverMissingError} when no driver can be resolved.
   */
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    // When no driver was passed directly, resolve from the container (set by
    // SessionProvider) and cache it on THIS instance. Caching per-instance rather
    // than on a class static keeps the driver scoped to its own app — two apps in
    // one process (or a test that swaps drivers) never share the first-resolved
    // one. `session.driver` is a container singleton, so this stays cheap.
    if (!this.options.driver) {
      const rootContainer = (
        http.container as unknown as {
          container?: { make(k: string): Promise<unknown> };
        }
      ).container;
      if (!rootContainer) throw new SessionDriverMissingError();
      this.options.driver = (await rootContainer.make("session.driver" as never)) as SessionDriver;
    }

    const { id, data } = await this.options.driver.loadFromRequest(http.request);
    const session = new SessionManager(id, data, this.options.driver);
    // http.session is declared on HttpContext (typed as SessionContract, which
    // SessionManager implements), so the assignment needs no cast.
    http.session = session;

    // Hook for sub-classes (e.g. AuthSessionMiddleware) to run after load
    await this._afterLoad(http, session);

    // Persist once the final response exists — which is *after* the pipeline has
    // unwound. A `finally` block here would run too early on the error path: when
    // a handler throws, no response has been built yet, so the session (and with
    // it every flashed value) would be dropped. `validate()` failing is exactly
    // that case — it stores the errors and old input, then throws a redirect.
    const driver = this.options.driver;
    http.onResponseReady(async (response) => {
      await driver.saveSession(session._id, session._prepareForSave(), response);
      // Invalidate IDs replaced by regenerate() — without this, the old
      // server-side record (e.g. the Redis key) stays valid until TTL,
      // defeating the point of regenerating on login (session fixation).
      for (const oldId of session._abandonedIds) {
        if (oldId !== session._id) await driver.destroy?.(oldId);
      }
    });

    return await next();
  }

  /**
   * @internal Extension hook — override in sub-classes to act on the freshly
   * loaded session before `next()` runs. The base implementation is a no-op;
   * {@link AuthSessionMiddleware} uses it to hydrate `ctx.user`.
   * @param _ctx - The current HTTP context.
   * @param _session - The session just loaded for this request.
   */
  protected async _afterLoad(_ctx: HttpContext, _session: SessionManager): Promise<void> {}
}
