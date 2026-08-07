import { RequestContext } from "@zerotal/core";

/**
 * Redirect to an external URL, or force a full-page (non-Inertia) visit to an internal one.
 *
 * @remarks
 * A normal Inertia visit expects a JSON page object, so it cannot follow an ordinary
 * redirect off the SPA. For an Inertia XHR this helper responds `409 Conflict` with an
 * `X-Inertia-Location` header, which
 * tells the client to do a hard `window.location` navigation; for a plain request it
 * responds with a standard `302` redirect. Use it for third-party URLs (payment
 * portals, OAuth providers) or any target that must leave the SPA.
 *
 * Reads the current request from `RequestContext` and sets `ctx.response` as a side
 * effect (returns `void`), like {@link inertia}.
 *
 * @param url - The absolute or relative URL to send the browser to.
 *
 * @example
 * ```ts
 * // Send the user off to an external billing portal.
 * async billing(http: HttpContext): Promise<void> {
 *   const session = await stripe.createBillingSession(Auth.id());
 *   return location(session.url);
 * }
 * ```
 */
export function location(url: string): void {
  const ctx = RequestContext.get();
  const isInertia = ctx.request.headers.get("X-Inertia") === "true";

  ctx.response = isInertia
    ? new Response(null, { status: 409, headers: { "X-Inertia-Location": url } })
    : new Response(null, { status: 302, headers: { Location: url } });
}
