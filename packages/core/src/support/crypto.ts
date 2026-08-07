/**
 * Shared cryptographic helpers.
 *
 * These exist so that constant-time comparison and SHA-256 hex digests are
 * implemented exactly once. Auth, session, and crypt code must use these
 * instead of re-implementing `timingSafeEqual` casts or hashing idioms —
 * the 2026-07 code review found six independent copies of the compare and
 * four of the digest, in two different idioms.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison.
 *
 * Returns `false` (rather than throwing) when lengths differ. Length is not
 * secret for the token formats used across the framework (fixed-length
 * hashes, hex digests, OTP codes), so the early return does not leak
 * anything useful.
 *
 * @example
 * if (!safeEqual(candidateHash, storedHash)) throw new InvalidTokenError();
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab as unknown as Uint8Array, bb as unknown as Uint8Array);
}

/**
 * SHA-256 digest of `input`, hex-encoded. Synchronous, via `Bun.CryptoHasher`.
 *
 * This is the canonical helper for token-hash storage (remember tokens,
 * reset tokens, OTPs, PATs, recovery codes): store `sha256Hex(token)`,
 * never the token itself.
 */
export function sha256Hex(input: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex");
}

/**
 * HMAC-SHA256 of `payload` under `key`, hex-encoded. Synchronous, via
 * `Bun.CryptoHasher`.
 *
 * The canonical helper for keyed signing across the framework (signed URLs,
 * snapshot checksums, signed upload paths). Pair it with {@link safeEqual} to
 * verify — never compare digests with `===`. Use {@link sha256Hex} instead when
 * hashing an unkeyed token for storage.
 */
export function hmacHex(payload: string | Uint8Array, key: string): string {
  return new Bun.CryptoHasher("sha256", key).update(payload).digest("hex");
}
