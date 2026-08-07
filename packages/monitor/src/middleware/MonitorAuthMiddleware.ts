/**
 * Guards the monitoring panel. Resolves the panel config from the container and
 * runs its `auth(user)` predicate; denies access otherwise. Mirrors the admin
 * package's guard so behaviour is consistent across Zerotal's ops surfaces.
 */
import type { Pipe, NextFn, HttpContext } from "@zerotal/core";
import { currentApp } from "@zerotal/core";
import type { ResolvedMonitorConfig } from "../config.ts";

export class MonitorAuthMiddleware implements Pipe<HttpContext> {
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const config = currentApp().container.makeSync("monitor") as ResolvedMonitorConfig;
    const user = (http as { user?: unknown }).user ?? null;
    const allowed = await config.auth(user);
    if (!allowed) {
      return Response.redirect("/login", 302);
    }
    return next();
  }
}
