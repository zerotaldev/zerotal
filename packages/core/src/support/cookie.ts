/**
 * Shared cookie helpers.
 *
 * A single place to build a `Set-Cookie` value and to read a cookie off a
 * request, so session drivers, CSRF, and "remember me" don't each re-implement
 * the attribute assembly and header parsing (the 2026-07 review found the pair
 * copied across four files). Keeping it here means a future change — a
 * `__Host-` prefix, `SameSite=Strict`, a `Partitioned` attribute — happens once.
 */

export type SameSite = "Strict" | "Lax" | "None";

export interface CookieOptions {
  /** Cookie name. */
  name: string;
  /** Cookie value (caller is responsible for encoding if needed). */
  value: string;
  /** `Path` attribute. Defaults to `/`. */
  path?: string | undefined;
  /** `Max-Age` in seconds. Omit for a session cookie. `0` clears the cookie. */
  maxAge?: number | undefined;
  /** `SameSite` attribute. Defaults to `Lax`. */
  sameSite?: SameSite | undefined;
  /** Add the `HttpOnly` attribute. Defaults to `true` — pass `false` for cookies JS must read (e.g. XSRF-TOKEN). */
  httpOnly?: boolean | undefined;
  /** Add the `Secure` attribute. Defaults to `false`. */
  secure?: boolean | undefined;
  /** `Domain` attribute. Omitted when absent. */
  domain?: string | undefined;
}

/**
 * Build a `Set-Cookie` header value from structured options.
 *
 * @example
 * buildCookie({ name: "session", value, maxAge: 86400, secure: true });
 * // "session=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure"
 *
 * @internal
 */
export function buildCookie(options: CookieOptions): string {
  const parts = [`${options.name}=${options.value}`, `Path=${options.path ?? "/"}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Read a single cookie value off a request by name.
 *
 * Prefers Bun's native `request.cookies` (`Bun.CookieMap`, populated on
 * `Bun.serve`-served requests) and falls back to parsing the `Cookie` header
 * for synthetic requests (e.g. tests) where the native map is absent.
 */
export function readCookie(request: Request, name: string): string | undefined {
  const cookies = (request as { cookies?: Bun.CookieMap }).cookies;
  if (cookies) return cookies.get(name) ?? undefined;
  return parseCookieHeader(request.headers.get("Cookie") ?? "", name);
}

/**
 * Extract a single cookie value from a raw `Cookie` header string.
 *
 * @internal
 */
export function parseCookieHeader(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    if (part.slice(0, eqIdx).trim() === name) {
      return part.slice(eqIdx + 1).trim();
    }
  }
  return undefined;
}
