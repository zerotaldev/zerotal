/**
 * Turns unhandled exceptions into HTTP responses. Defines the base
 * `ExceptionHandler` apps subclass, plus the default error-to-response logic
 * that negotiates HTML, JSON, redirects, and the dev stack-trace page.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { ZerotalError } from "../errors/ZerotalError.ts";
import { renderDevErrorPage, renderHttpErrorPage } from "./DevErrorPage.ts";
import { devSurfacesEnabled } from "../support/env.ts";

/**
 * Base class for application-level exception handling.
 *
 * Register a subclass with `app.withExceptionHandler(Handler)` in
 * bootstrap/app.ts. The framework calls `report()` then `render()` for
 * every unhandled exception thrown by a route handler or middleware.
 *
 * @example
 * // app/exceptions/Handler.ts
 * import { ExceptionHandler } from '@zerotal/core';
 *
 * export class Handler extends ExceptionHandler {
 *   override async render(err: unknown, ctx: HttpContext): Promise<Response> {
 *     if (err instanceof ModelNotFoundError) {
 *       return Response.json({ message: 'Not found' }, { status: 404 });
 *     }
 *     return super.render(err, ctx);
 *   }
 * }
 */
export abstract class ExceptionHandler {
  // Explicit constructor so JSC's function-coverage counter attributes
  // the super() call from subclasses to this entry.
  constructor() {}

  protected dontReport: Array<new (...args: never[]) => unknown> = [];

  private static readonly _alwaysSilent = new Set([
    "ValidationRedirectError",
    "ValidationJsonError",
    "ValidationError",
    "PrecognitionResponse",
    "NotFoundError",
  ]);

  protected shouldReport(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name;
    if (name && ExceptionHandler._alwaysSilent.has(name)) return false;
    for (const Type of this.dontReport) {
      if (error instanceof (Type as unknown as new (...args: never[]) => object)) return false;
    }
    return true;
  }

  async report(error: unknown, _ctx?: HttpContext): Promise<void> {
    if (!this.shouldReport(error)) return;
    console.error("[Zerotal] Unhandled error:", error);
  }

  async render(error: unknown, ctx: HttpContext): Promise<Response> {
    return ExceptionHandler.defaultRender(error, ctx);
  }

  /**
   * Shared error → Response logic.
   *
   * Response format depends on what the client accepts:
   *
   *   Browser (Accept: text/html)  → styled HTML page (all error classes)
   *   Inertia XHR (X-Inertia: true) → JSON (Inertia shows its own modal)
   *   API client (Accept: application/json) → JSON
   *
   * Error-class routing:
   *   1. ValidationRedirectError → 303 redirect (always, any client)
   *   2. ValidationJsonError     → 422 JSON (always — the errors object IS the response)
   *   3. ZerotalError 4xx           → styled 4xx HTML or JSON depending on client
   *   4. Everything else         → dev stack-trace page or minimal 500
   */
  static async defaultRender(error: unknown, ctx?: HttpContext): Promise<Response> {
    // Fail closed for debug output: the dev stack-trace page needs either a
    // developer-supervised process (the `serve --dev` worker) or an explicitly
    // non-prod APP_ENV. An unset/unknown/`staging` environment is treated as
    // production, so a deploy that forgets to set it never leaks stack traces
    // or source context to clients.
    const isProduction = !devSurfacesEnabled();
    const wantsHtml = _wantsHtml(ctx);

    // ── Always-redirect: never render as HTML or JSON ─────────────────────
    const name = (error as { name?: string } | null)?.name;

    if (name === "ValidationRedirectError") {
      const { redirectTo } = error as { redirectTo: string };
      return new Response(null, {
        status: 303,
        headers: { Location: redirectTo },
      });
    }

    // ── Precognition: the error builds its own 204/422 response ───────────────
    if (name === "PrecognitionResponse") {
      return (error as { toResponse(): Response }).toResponse();
    }

    // ── Validation errors: structured JSON (form submits use redirect above) ─
    if (name === "ValidationJsonError") {
      const { errors } = error as { errors: Record<string, string> };
      return Response.json({ message: "Validation failed", errors }, { status: 422 });
    }

    // ── Named HTTP errors (4xx / 5xx ZerotalError subclasses) ────────────────
    if (error instanceof Error && "status" in error) {
      const httpError = error as ZerotalError;
      const status = httpError.status;
      const extraHeaders = (error as { headers?: Record<string, string> }).headers;

      if (wantsHtml) {
        if (!isProduction && status >= 500) {
          return _withHeaders(renderDevErrorPage(error, ctx), extraHeaders);
        }
        return _withHeaders(
          renderHttpErrorPage(status, httpError.message, httpError.code, ctx),
          extraHeaders,
        );
      }

      return Response.json(
        { message: httpError.message, code: httpError.code },
        { status, ...(extraHeaders ? { headers: extraHeaders } : {}) },
      );
    }

    // ── Unknown / unhandled errors (genuine bugs) ─────────────────────────
    if (!isProduction && wantsHtml) {
      return renderDevErrorPage(error, ctx);
    }

    if (!isProduction) {
      // API client in dev: JSON with message.
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ message, code: "E_INTERNAL" }, { status: 500 });
    }

    // Production: no internals exposed.
    if (wantsHtml) {
      return renderHttpErrorPage(500, "Internal Server Error", undefined, ctx);
    }
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

/** Merge extra headers into a (possibly pending) Response and return it. */
async function _withHeaders(
  res: Response | Promise<Response>,
  headers?: Record<string, string>,
): Promise<Response> {
  const resolved = await res;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) resolved.headers.set(key, value);
  }
  return resolved;
}

/**
 * True when the client will render an HTML response.
 *
 * Covers both regular browser navigation AND Inertia XHR — Inertia sends
 * `Accept: text/html` and shows non-Inertia HTML responses in its error
 * modal (iframe overlay), which is exactly what we want for the dev page.
 *
 * Returns false only for pure JSON clients (`Accept: application/json`).
 */
function _wantsHtml(ctx?: HttpContext): boolean {
  try {
    if (!ctx?.request) return false;
    const accept = ctx.request.headers.get("Accept") ?? "";
    // Pure JSON clients — return JSON.
    if (accept.startsWith("application/json")) return false;
    // Browsers and Inertia XHR both include text/html in Accept.
    return accept.includes("text/html");
  } catch {
    return false;
  }
}
