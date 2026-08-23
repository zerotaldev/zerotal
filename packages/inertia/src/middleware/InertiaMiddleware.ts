import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, withHeaders } from "@zerotal/core";
import { assetVersion } from "../version.ts";

/**
 * Must be registered as global middleware in Application.use()
 * or in AppServiceProvider before other middleware.
 *
 * Handles the Inertia protocol requirements:
 *
 * 1. 303 redirect after POST/PUT/DELETE
 *    When a non-GET Inertia request results in a standard 302 redirect,
 *    Inertia requires a 303 to force the browser to GET the redirect target.
 *    Without this, browsers repeat the original POST method on the redirect.
 *
 * 2. Asset version mismatch (409 Conflict)
 *    If the client sends X-Inertia-Version that differs from the server's
 *    current asset version, respond with 409 and X-Inertia-Location header.
 *    This triggers a full page reload on the client to pick up new assets.
 *
 * 3. Always set Vary: X-Inertia on all responses
 *    Ensures browser cache treats HTML and JSON versions as distinct.
 */
/**
 * Every status the client can be handed as a redirect.
 *
 * 307 and 308 are here to be *marked*, not converted — an app that picks a
 * method-preserving redirect means it, and a response the client cannot
 * recognise as Inertia's is the failure this list exists to prevent.
 */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export class InertiaMiddleware extends BaseMiddleware {
  protected options: Record<string, never> = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const isInertia = http.request.headers.get("X-Inertia") === "true";

    // Asset version check — only for Inertia XHR GET requests
    if (isInertia && http.request.method === "GET") {
      const clientVersion = http.request.headers.get("X-Inertia-Version");
      const serverVersion = assetVersion();

      if (clientVersion && serverVersion && clientVersion !== serverVersion) {
        // Client has stale assets — force full reload
        return new Response(null, {
          status: 409,
          headers: {
            "X-Inertia-Location": http.url.href,
          },
        });
      }
    }

    // Run the rest of the pipeline
    const response = await next();

    // After the pipeline: apply response transformations
    if (!response) return;

    const status = response.status;
    const method = http.request.method;
    const isRedirect = REDIRECT_STATUSES.includes(status);

    if (isInertia && isRedirect) {
      const target = response.headers.get("Location") ?? "";

      // Fragment redirects: a redirect whose target carries a URL fragment (#...) on an Inertia
      // request becomes a 409 + X-Inertia-Redirect, so the client performs a standard Inertia visit
      // (preserving the fragment) instead of a full reload.
      if (target.includes("#")) {
        // Same header-preservation concern as the redirect branch below.
        const headers = new Headers(response.headers);
        headers.delete("Location");
        headers.set("X-Inertia-Redirect", target);
        headers.set("X-Inertia", "true");
        return new Response(null, { status: 409, headers });
      }

      // Carry the original headers over. Rebuilding the Response from just `Location` dropped
      // every other header the handler set — most importantly `Set-Cookie`, so `POST /login`
      // returned a 303 to /dashboard with the session cookie discarded and the user still
      // logged out.
      const headers = new Headers(response.headers);
      headers.set("Location", target || "/");

      // Stamped on *every* Inertia redirect, not only the ones converted below.
      //
      // It used to be set inside the conversion, which meant a handler that
      // already returned the 303 the protocol asks for — `http.redirect(to, 303)`
      // — skipped the only line that marked the response as Inertia's. The
      // request succeeded, the row was written, and the form sat there with the
      // fields still filled in: the worst shape a failure can take, because
      // nothing about it looks like an error from either end.
      headers.set("X-Inertia", "true");
      if (!headers.has("Vary")) headers.set("Vary", "X-Inertia");

      // A non-GET 301/302 becomes a 303, so the browser follows with GET instead
      // of repeating the method against the target. 307 and 308 are left alone:
      // preserving the method is the whole reason to choose them.
      const needsSeeOther = method !== "GET" && (status === 301 || status === 302);
      return new Response(null, { status: needsSeeOther ? 303 : status, headers });
    }

    // Never wrap streaming responses (e.g. SSE) — re-creating the Response
    // object with new Headers would transfer and potentially disturb the
    // ReadableStream body, breaking long-lived connections.
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.startsWith("text/event-stream")) return response;

    // Ensure Vary: X-Inertia is present on all responses
    // Required so browser cache does not confuse HTML and JSON versions
    if (response.headers.has("Vary")) return response;
    return withHeaders(response, { Vary: "X-Inertia" });
  }
}
