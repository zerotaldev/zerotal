import { BaseMiddleware, devSurfacesEnabled } from "@zerotal/core";
import type { NextFn, HttpContext } from "@zerotal/core";

/**
 * Fail-closed default guard for the admin panel.
 *
 * The panel exposes full CRUD, so shipping it with no guard is a footgun. When
 * `config/admin.ts` declares no `middleware`, the provider installs this guard
 * so the panel is **denied by default** in any production-like environment
 * (unset/unknown `APP_ENV`, `staging`, `production`). Local exploration
 * (`APP_ENV=development|local|test`) still passes through.
 *
 * To run the panel in production, set `middleware` in `config/admin.ts` to a
 * real auth/authorization stack (e.g. `[AuthMiddleware.with({ ... })]`). To
 * *deliberately* expose it without auth, set an explicit pass-through
 * middleware — an intentional, visible opt-out rather than a silent default.
 */
export class AdminGuardMiddleware extends BaseMiddleware {
  protected options = {};

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    // `devSurfacesEnabled()` — `APP_ENV` holds the runtime mode by now, so reading it
    // directly asked whether "web" is a development environment and always said no.
    if (devSurfacesEnabled()) return next();
    return new Response(
      "Admin panel is not accessible: no authentication is configured.\n" +
        "Set `middleware` in config/admin.ts to a real auth guard before exposing it.\n",
      { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}
