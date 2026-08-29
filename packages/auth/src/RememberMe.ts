/**
 * "Remember me" — persistent login across sessions.
 *
 * On login with `{ remember: true }`, a high-entropy token is minted: its SHA-256
 * hash is stored in the user's `rememberToken` column, and the raw token rides in
 * a long-lived `remember_web` cookie as `id|token`. After the session expires,
 * {@link RememberMeMiddleware} reads the cookie, looks the user up by id, and
 * constant-time-compares `sha256(cookieToken)` against the stored hash to
 * re-authenticate them — then re-seeds the session.
 *
 * Storing only the hash (not the raw token, as some frameworks do) means a leaked
 * database row cannot be replayed as a valid cookie.
 */
import { safeEqual, sha256Hex, buildCookie } from "@zerotal/core";

/**
 * Name of the persistent-login cookie.
 *
 * @internal
 */
export const REMEMBER_COOKIE = "remember_web";

/**
 * Cookie lifetime: 400 days.
 *
 * 400 days is the ceiling browsers enforce on `Max-Age` (Chrome 104+, followed by the
 * other engines), so a longer value is not a longer credential — it is the same credential
 * with a misleading number on it. The token is also rotated on every use, so the window an
 * intercepted cookie is valid for is the interval between the victim's own visits, not this.
 *
 * @internal
 */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * Generate a 60-char hex token (30 random bytes) for a new remember cookie.
 *
 * @internal
 */
export function mintRememberToken(): string {
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 hex of a raw token — this is what gets persisted, never the raw value.
 *
 * @internal
 */
export function hashRememberToken(raw: string): string {
  return sha256Hex(raw);
}

/**
 * Constant-time check that a raw cookie token matches a stored hash
 * (`safeEqual`'s length pre-check is safe: the hash length is a fixed public
 * constant).
 *
 * @internal
 */
export function rememberTokenMatches(rawFromCookie: string, storedHash: string): boolean {
  return safeEqual(hashRememberToken(rawFromCookie), storedHash);
}

/** Encode the cookie value: `id|rawToken`. */
export function encodeRememberValue(id: number | string, rawToken: string): string {
  return `${id}|${rawToken}`;
}

/** Parse `id|rawToken`, or null when malformed. */
export function parseRememberValue(value: string): { id: string; token: string } | null {
  const i = value.indexOf("|");
  if (i === -1) return null;
  const id = value.slice(0, i);
  const token = value.slice(i + 1);
  if (!id || !token) return null;
  return { id, token };
}

/**
 * Build the Set-Cookie header value for issuing the remember cookie.
 *
 * `Secure` defaults to **on**: this is a long-lived, password-free credential, and the one
 * deployment where a request URL looks like plain `http:` — behind a TLS-terminating proxy —
 * is exactly the one where dropping `Secure` is most wrong. Local HTTP development opts out
 * explicitly via `RememberMeMiddleware.with({ secure: false })`.
 */
export function buildRememberCookie(
  value: string,
  opts: { maxAge?: number; secure?: boolean } = {},
): string {
  return buildCookie({
    name: REMEMBER_COOKIE,
    value,
    maxAge: opts.maxAge ?? REMEMBER_MAX_AGE,
    secure: opts.secure ?? true,
  });
}

/** Build the Set-Cookie header value that clears the remember cookie. */
export function forgetRememberCookie(secure = true): string {
  return buildCookie({ name: REMEMBER_COOKIE, value: "", maxAge: 0, secure });
}

/**
 * Pending remember-cookie action stashed on the HttpContext by the `Auth` facade,
 * flushed onto the response by {@link RememberMeMiddleware} after the request.
 */
export type RememberAction = { type: "set"; value: string } | { type: "clear" };
