/**
 * Return a copy of `res` with the given headers added/overwritten.
 *
 * A `Response` produced by `Response.redirect()` (or `Response.error()`) has an
 * **immutable** headers guard — calling `res.headers.set(...)` on it throws.
 * Middleware that decorates the downstream response (CORS, security headers,
 * rate-limit info, …) must therefore reconstruct rather than mutate in place.
 * `new Response(body, ...)` always yields a mutable guard, so the copy is safe.
 *
 * @example
 * async handle(_, next) {
 *   const res = await next();
 *   return res ? withHeaders(res, { "X-Frame-Options": "DENY" }) : res;
 * }
 */
export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const merged = new Headers(res.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}
