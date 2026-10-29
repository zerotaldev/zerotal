/**
 * Turns unhandled exceptions into HTTP responses. Defines the base
 * `ExceptionHandler` apps subclass, plus the default error-to-response logic
 * that negotiates HTML, JSON, redirects, and the dev stack-trace page.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { ZerotalError } from "../errors/ZerotalError.ts";
import { _ABORTED, _HTTP_ERROR } from "../errors/HttpError.ts";
import { renderDevErrorPage, renderHttpErrorPage } from "./DevErrorPage.ts";
import { devSurfacesEnabled } from "../support/env.ts";
import { _prefersJson } from "../http/negotiate.ts";

/**
 * Errors that are an ordinary outcome of a request rather than a fault: a URL nothing
 * matches, a form that failed validation. They are rendered, never reported as unhandled.
 */
const _EXPECTED_OUTCOMES: ReadonlySet<string> = new Set([
  "ValidationRedirectError",
  "ValidationJsonError",
  "ValidationError",
  "PrecognitionResponse",
  "NotFoundError",
]);

/**
 * Whether `error` is an expected outcome of a request, so nothing is wrong and nothing should
 * be logged as an error.
 *
 * One list for both error paths. `ExceptionHandler.report()` already skipped these, but the
 * path an app takes before it registers a handler of its own — every fresh app — logged them
 * as `ERROR Unhandled error`, stack trace and all: a mistyped URL, or a bot probing
 * `/wp-admin`, or a form with one mistake in it.
 *
 * So is an error the framework raises to answer the client, when its status is below 500: an
 * `HttpError` (a `ForbiddenError`, a `ConflictError`) or whatever `abort()` threw. Those are
 * thrown on purpose, and the client is told why. An error that merely carries a status is not
 * one: an `HttpClientError` from an upstream 401, or an API or AI client's error, is a fault in
 * this request whatever the status it repeats. `HttpError` and `abort()` are each found by a
 * registered symbol rather than by `instanceof`, because an app can hold two copies of core and
 * an error built by one is not an instance of the other's class. Not by a class name: an app's
 * own class named `HttpError` is not the framework answering the client. It must still be an
 * `Error`, which is what `defaultRender()` answers with that status: anything else (a thrown
 * `Response`, a plain object) is answered with a 500.
 *
 * @internal
 */
export function _isExpectedOutcome(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  if (typeof name === "string" && _EXPECTED_OUTCOMES.has(name)) return true;
  if (!(error instanceof Error) || !(_ABORTED in error || _HTTP_ERROR in error)) return false;
  return typeof status === "number" && status >= 100 && status < 500;
}

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

  protected shouldReport(error: unknown): boolean {
    if (_isExpectedOutcome(error)) return false;
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
   *   Inertia visit (Accept: text/html, …) → HTML, shown in Inertia's error modal
   *   Accept prefers application/json to text/html (X-Inertia or not) → JSON
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
 * Returns false when `Accept` prefers `application/json` to `text/html`, by q-value and then by
 * order: the same rule as the validator's 422-or-redirect choice, so a request that gets a JSON
 * validation error also gets a JSON 404. `X-Inertia` does not change it: Inertia's own visits
 * send `Accept: text/html, application/xhtml+xml`.
 */
function _wantsHtml(ctx?: HttpContext): boolean {
  try {
    if (!ctx?.request) return false;
    const accept = ctx.request.headers.get("Accept") ?? "";
    // A client that prefers JSON to HTML gets JSON.
    if (_prefersJson(accept)) return false;
    // Browsers and Inertia XHR both include text/html in Accept.
    return accept.includes("text/html");
  } catch {
    return false;
  }
}
