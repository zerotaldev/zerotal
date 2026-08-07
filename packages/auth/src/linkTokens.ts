/**
 * Signed link tokens — shared primitives for the stateless, signed links used by
 * {@link EmailVerification} and {@link PasswordReset}.
 *
 * @remarks
 * A token is `Crypt`-encrypted (AES-256-GCM, keyed by APP_KEY) claims, URL-safe so
 * it can ride in a path/query segment. No database table is involved. Single-use is
 * enforced through the cache: once a token's `jti` is consumed it is recorded as used
 * (TTL equal to the link's remaining lifetime), so a replay is rejected and the entry
 * self-evicts when the link would have expired. The cache is used **gracefully** — if
 * no `CacheProvider` is registered, single-use is skipped (the stateless checks still
 * apply) and `isLinkUsed` reports `false`, so `@zerotal/cache` stays an optional
 * enhancement.
 *
 * @packageDocumentation
 */

import { sha256Hex } from "@zerotal/core";
import { Crypt } from "@zerotal/core/security";
import { Cache } from "@zerotal/cache";

/** @internal Standard base64 → URL-safe, so a token rides in a path/query segment. */
function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** @internal URL-safe → standard base64, the inverse of {@link toUrlSafe}. */
function fromUrlSafe(token: string): string {
  return token.replace(/-/g, "+").replace(/_/g, "/");
}

/** Encrypt claims into a stateless, URL-safe token. */
export function signToken(claims: object): string {
  return toUrlSafe(Crypt.encrypt(claims));
}

/** Decrypt a token back to its claims, or `null` when tampered, wrong-key, or malformed. */
export function readToken<T>(token: string): T | null {
  if (!token) return null;
  try {
    return Crypt.decrypt<T>(fromUrlSafe(token));
  } catch {
    return null;
  }
}

/** A short, stable fingerprint of a string (e.g. the current password hash). */
export function fingerprint(value: string): string {
  return sha256Hex(value).slice(0, 16);
}

/** A unique token id, embedded in claims so a specific link can be marked used. */
export function newJti(): string {
  return crypto.randomUUID();
}

/** Current time in whole seconds (matches the `exp` claim unit). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Single-use (cache-backed, graceful) ──────────────────────────────────────

/** True when this token (`jti`) has already been consumed. Skips when cache is absent. */
export async function isLinkUsed(kind: string, jti: string): Promise<boolean> {
  try {
    return await Cache.has(`link:${kind}:used:${jti}`);
  } catch {
    return false; // no CacheProvider — single-use not enforced
  }
}

/** Mark a token consumed until it would expire (`exp` is a UNIX seconds timestamp). */
export async function markLinkUsed(kind: string, jti: string, exp: number): Promise<void> {
  const ttl = Math.max(1, exp - nowSeconds());
  try {
    await Cache.set(`link:${kind}:used:${jti}`, 1, ttl);
  } catch {
    // no CacheProvider — nothing to record
  }
}
