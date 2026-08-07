import { BaseMiddleware } from "@zerotal/core";
import type { NextFn, HttpContext } from "@zerotal/core";
import { Panel } from "../Panel.ts";

/**
 * Enforces a page's declared ability at the route.
 *
 * The sidebar already hides destinations the user may not reach, but hiding a
 * link is presentation, not access control — the URL is still typeable. This
 * middleware runs the *same* {@link Panel.can} check the sidebar used, so the two
 * can't drift: what you cannot see, you cannot open.
 *
 * Mounted per page by {@link AdminProvider}, on top of the panel-wide guard.
 */
export class AdminAbilityMiddleware extends BaseMiddleware<{ ability?: string | undefined }> {
  protected options: { ability?: string | undefined } = {};

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    if (await Panel.can(this.options.ability)) return next();
    return new Response("Not authorized.\n", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
