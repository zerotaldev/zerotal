import { ExceptionHandler, ZerotalError, devSurfacesEnabled, type HttpContext } from "zerotal";
import { ModelNotFoundError } from "zerotal/orm";
import { ErrorPage } from "../flow/pages/error";
import { documentHead } from "../flow/lib/document";

/**
 * Renders HTTP errors as a page inside the app's own shell.
 *
 * Registered in bootstrap/app.ts. Without it, a mistyped URL lands on the
 * framework's plain error page — correct, but jarring after the rest of the app.
 * This hands the status to app/flow/pages/error.tsx instead.
 *
 * Two cases deliberately fall through to `super.render()`:
 *
 *   - **A 5xx in development.** The framework's stack-trace page is far more
 *     useful than a tidy "something broke", so it keeps priority while dev
 *     surfaces are on. Client errors (404, 403, …) always render the app's page,
 *     including in development — otherwise you could never see your own.
 *   - **API clients.** Anything asking for JSON keeps getting JSON, which is also
 *     what the browser script's PUT and DELETE forms ask for.
 */

/** Statuses this app renders as a page; everything else uses the default. */
const RENDERED = new Set([403, 404, 419, 429, 500, 503]);

function statusOf(error: unknown): number {
  return error instanceof ZerotalError ? error.status : 500;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class Handler extends ExceptionHandler {
  // A missing record is the visitor's 404, not the app's fault: `/projects/999/edit`
  // binds `:project` with `findOrFail`, and that is not worth a stack trace in the log.
  protected override dontReport = [ModelNotFoundError];

  override async render(error: unknown, ctx: HttpContext): Promise<Response> {
    const status = statusOf(error);
    const wantsHtml = (ctx.request.headers.get("Accept") ?? "").includes("text/html");

    if (!wantsHtml || !RENDERED.has(status)) {
      return super.render(error, ctx);
    }
    if (status >= 500 && devSurfacesEnabled()) {
      return super.render(error, ctx);
    }

    // The page is rendered here rather than through a route — there is no route for a URL
    // that does not exist — so the document around it is written here too, with the same
    // head as every other page.
    const page = new ErrorPage();
    page.status = status;
    await page.onBoot(ctx);
    const body = await page.render();
    const document = await page.layout({ html: `<div data-flow-page>${body.html}</div>` });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(ErrorPage.title(page))}</title>
  ${documentHead()}
</head>
<body>
  ${document.html}
</body>
</html>`;

    return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}
