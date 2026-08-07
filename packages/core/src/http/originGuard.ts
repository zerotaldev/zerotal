/**
 * Origin checking for endpoints that bypass the normal middleware pipeline.
 *
 * Two request shapes in the framework are not protected by `CsrfMiddleware`:
 *
 *  - **WebSocket upgrades.** The handshake is exempt from the same-origin policy but still
 *    carries cookies, so `evil.com` opening `wss://app/...` gets a fully authenticated socket.
 *    That is cross-site WebSocket hijacking, and an `Origin` check is the standard defence —
 *    browsers always send the header on a WS handshake and script cannot forge it.
 *
 *  - **Raw routes** registered via `Router.raw()`, which are stored outside the pipeline.
 *    Flow's `/__flow/http` action fallback is one: a cross-origin `fetch` with
 *    `credentials: "include"` and the default `text/plain` content type is a CORS-*simple*
 *    request, so there is no preflight to stop it and no CSRF middleware in its path.
 *
 * The check is deliberately conservative about non-browser clients: a request with no `Origin`
 * header is allowed, because native/CLI clients do not send one and are not subject to
 * cross-site request forgery in the first place. Anything that *does* declare an origin must
 * declare one we recognise.
 */

/**
 * Whether a request's `Origin` header is acceptable for a credentialed, pipeline-bypassing
 * endpoint.
 *
 * @param request - The incoming request. Its own URL supplies the server origin.
 * @param allowedOrigins - Additional origins to accept, for deployments where the browser
 *   app is served from a different host than the API (e.g. an SPA on `app.example.com`
 *   talking to `api.example.com`). Compared exactly — no wildcards, no suffix matching,
 *   because `endsWith(".example.com")` also matches `evil-example.com`.
 * @returns `true` when the request may proceed.
 *
 * @example
 * ```ts
 * if (!isAllowedOrigin(req, config('app.wsAllowedOrigins'))) {
 *   return new Response('Forbidden origin', { status: 403 });
 * }
 * ```
 */
export function isAllowedOrigin(request: Request, allowedOrigins: string[] = []): boolean {
  const origin = request.headers.get("origin");

  // No Origin: not a browser-initiated cross-site request. Native clients, server-to-server
  // callers and most CLI tooling omit it entirely.
  if (origin === null || origin === "") return true;

  // "null" is what a sandboxed iframe, a `data:` document or a redirected cross-origin request
  // sends. It is never a legitimate first-party caller, so it is refused explicitly rather than
  // falling through to the URL comparison below (where `new URL("null")` would throw).
  if (origin === "null") return false;

  let selfOrigin: string;
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  if (origin === selfOrigin) return true;
  return allowedOrigins.includes(origin);
}

/**
 * Read the configured extra origins for pipeline-bypassing endpoints.
 *
 * Kept separate from {@link isAllowedOrigin} so the check itself stays pure and trivially
 * testable. Returns an empty list when unset or malformed — i.e. same-origin only, which is
 * the safe default.
 *
 * @param config - The resolved `app` config object, or anything shaped like it.
 */
export function allowedOriginsFrom(config: unknown): string[] {
  const value = (config as { allowedOrigins?: unknown } | null | undefined)?.allowedOrigins;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
