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
    const isRedirect = [301, 302, 303].includes(status);

    // Fragment redirects: a redirect whose target carries a URL fragment (#...) on an Inertia
    // request becomes a 409 + X-Inertia-Redirect, so the client performs a standard Inertia visit
    // (preserving the fragment) instead of a full reload.
    if (isInertia && isRedirect) {
      const target = response.headers.get("Location") ?? "";
      if (target.includes("#")) {
        // Same header-preservation concern as the 303 branch below.
        const headers = new Headers(response.headers);
        headers.delete("Location");
        headers.set("X-Inertia-Redirect", target);
        headers.set("X-Inertia", "true");
        return new Response(null, { status: 409, headers });
      }
    }

    // Convert 302 to 303 for non-GET Inertia redirects
    // Inertia requires 303 so browsers use GET on the redirect target
    if (isInertia && [301, 302].includes(status) && method !== "GET") {
      // Carry the original headers over. Rebuilding the Response from just `Location` dropped
      // every other header the handler set — most importantly `Set-Cookie`, so `POST /login`
      // returned a 303 to /dashboard with the session cookie discarded and the user still
      // logged out.
      const headers = new Headers(response.headers);
      headers.set("Location", response.headers.get("Location") ?? "/");
      headers.set("X-Inertia", "true");
      return new Response(null, { status: 303, headers });
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
