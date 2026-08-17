import { ExceptionHandler, ZerotalError, devSurfacesEnabled, view, type HttpContext } from "zerotal";
import { ErrorPage } from "../../resources/views/ErrorPage.tsx";

/**
 * Renders HTTP errors as a page inside the app's own shell.
 *
 * The same three fall-throughs as the Inertia build — a 5xx while dev surfaces
 * are on keeps the framework's stack trace, and anything asking for JSON keeps
 * getting JSON — minus the one that cannot apply here: there are no XHR visits
 * to protect, because there is no client router.
 *
 * That absence is the recipe's point. Same statuses, same copy, same URL; only
 * the mechanism differs.
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

    if (!wantsHtml || !RENDERED.has(status)) return super.render(error, ctx);
    if (status >= 500 && devSurfacesEnabled()) return super.render(error, ctx);

    // `view()` writes onto the context rather than returning, so the body is
    // re-wrapped to carry the real status instead of a 200.
    view(<ErrorPage status={status} />);
    const rendered = ctx.response;
    if (!rendered) return super.render(error, ctx);

    return new Response(rendered.body, { status, headers: rendered.headers });
  }
}
