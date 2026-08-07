import {
  ExceptionHandler,
  ZerotalError,
  devSurfacesEnabled,
  type HttpContext,
} from "zerotal";
import { inertia } from "@zerotal/inertia";

/**
 * Renders HTTP errors as a page inside the app's own shell.
 *
 * Registered in bootstrap/app.ts. Without it, a mistyped URL lands on the
 * framework's plain error page — correct, but jarring after the rest of the app.
 * This hands the status to resources/js/pages/error.tsx instead.
 *
 * Three cases deliberately fall through to `super.render()`:
 *
 *   - **A 5xx in development.** The framework's stack-trace page is far more
 *     useful than a tidy "something broke", so it keeps priority while dev
 *     surfaces are on. Client errors (404, 403, …) always render the app's page,
 *     including in development — otherwise you could never see your own.
 *   - **Inertia XHR.** A client-side visit expects the adapter's own error
 *     handling; substituting a page object here would break it.
 *   - **API clients.** Anything asking for JSON keeps getting JSON.
 */

/** Statuses this app renders as a page; everything else uses the default. */
const RENDERED = new Set([403, 404, 419, 429, 500, 503]);

function statusOf(error: unknown): number {
  return error instanceof ZerotalError ? error.status : 500;
}

export class Handler extends ExceptionHandler {
  override async render(error: unknown, ctx: HttpContext): Promise<Response> {
    const status = statusOf(error);
    const wantsHtml = (ctx.request.headers.get("Accept") ?? "").includes("text/html");
    const isInertiaVisit = ctx.request.headers.get("X-Inertia") === "true";

    if (isInertiaVisit || !wantsHtml || !RENDERED.has(status)) {
      return super.render(error, ctx);
    }
    if (status >= 500 && devSurfacesEnabled()) {
      return super.render(error, ctx);
    }

    // `inertia()` writes the HTML onto the context rather than returning it, so
    // re-wrap the body to carry the real status instead of a 200.
    await inertia("error", { status });
    const rendered = ctx.response;
    if (!rendered) return super.render(error, ctx);

    return new Response(rendered.body, { status, headers: rendered.headers });
  }
}
