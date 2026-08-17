import { ExceptionHandler, ZerotalError, devSurfacesEnabled, type HttpContext } from "zerotal";
import { asset } from "zerotal/assets";

/**
 * Renders HTTP errors as a page, built as a string.
 *
 * No JSX and no Flow component, on purpose. This runs when something has
 * already gone wrong, and the render layer is one of the things that may be
 * what went wrong — an error page that boots a component, compiles a template
 * and opens a socket has several new ways to fail while reporting a failure.
 * A string template has none.
 *
 * Same reasoning as the copy being hard-coded English: `__()` resolves against a
 * catalog loaded by a provider that a 500 may be the symptom of.
 */

/** Statuses this app renders as a page; everything else uses the default. */
const RENDERED = new Set([403, 404, 419, 429, 500, 503]);

const COPY: Record<number, { title: string; body: string }> = {
  403: { title: "Not allowed", body: "You are signed in, but this page is not yours to see." },
  404: {
    title: "No page here",
    body: "The URL does not match any route. Check the address, or head back to the start.",
  },
  419: {
    title: "The page expired",
    body: "Your session timed out before the form was submitted. Reload and try once more.",
  },
  429: { title: "Too many requests", body: "You have been rate limited. Give it a moment and try again." },
  500: { title: "Something broke", body: "An error on our side stopped this request. It has been logged." },
  503: { title: "Down for maintenance", body: "The app is briefly unavailable. It should be back shortly." },
};

const FALLBACK = { title: "Something went wrong", body: "That request could not be completed." };

function escape(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

function page(status: number): string {
  const { title, body } = COPY[status] ?? FALLBACK;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${status} — ${escape(title)}</title>
  <link rel="icon" href="/zt.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="${asset("/css/app.css")}" />
</head>
<body class="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
  <section class="mx-auto max-w-lg text-center">
    <p aria-hidden="true" class="font-mono text-6xl font-semibold text-muted-foreground tabular-nums sm:text-7xl">${status}</p>
    <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">${escape(title)}</h1>
    <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">${escape(body)}</p>
    <div class="mt-8">
      <a href="/" class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">Back to home</a>
    </div>
  </section>
</body>
</html>`;
}

export class Handler extends ExceptionHandler {
  override async render(error: unknown, ctx: HttpContext): Promise<Response> {
    const status = error instanceof ZerotalError ? error.status : 500;
    const wantsHtml = (ctx.request.headers.get("Accept") ?? "").includes("text/html");

    if (!wantsHtml || !RENDERED.has(status)) return super.render(error, ctx);
    if (status >= 500 && devSurfacesEnabled()) return super.render(error, ctx);

    return new Response(page(status), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
