import { safeEqual, buildCookie, readCookie } from "@zerotal/core";
import type { RedisClient } from "bun";
import type { SessionDriver, SessionPayload } from "./CookieDriver.ts";

/**
 * @internal Sign a raw session ID with HMAC-SHA256.
 * Result format: `rawId.base64url(HMAC(rawId))`
 *
 * base64url encoding keeps the value safe for Set-Cookie values (no +/=//).
 */
function _signId(rawId: string, secret: string): string {
  return `${rawId}.${new Bun.CryptoHasher("sha256", secret).update(rawId).digest("base64url")}`;
}

/**
 * @internal Verify the HMAC signature on a signed session ID cookie value.
 * Returns the raw UUID if valid, null if tampered or malformed.
 *
 * Comparison uses `safeEqual` from @zerotal/core — constant-time via
 * node:crypto's `timingSafeEqual`, with a length pre-check that is safe to
 * short-circuit because the expected length is a fixed public constant
 * (HMAC-SHA256 base64url = 43 chars).
 */
function _verifyId(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const rawId = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = new Bun.CryptoHasher("sha256", secret).update(rawId).digest("base64url");
  return safeEqual(sig, expected) ? rawId : null;
}

/**
 * Redis-backed session driver.
 *
 * The cookie holds the session ID; all session data lives in Redis under
 * the key `session:{id}`. When a `secret` is provided the cookie value is
 * HMAC-signed (`id.signature`) so forged IDs are rejected before a Redis
 * lookup is ever attempted.
 *
 * Security improvement over the unsigned version:
 *  - Forged/tampered session IDs are detected server-side in constant time
 *    via `safeEqual` (@zerotal/core, backed by node:crypto's
 *    `timingSafeEqual`) — no Redis round-trip required for rejection.
 *  - Uses `Bun.CryptoHasher` with BoringSSL — hardware-accelerated on
 *    supported CPUs, with zero npm packages.
 *
 * @example
 * ```ts
 * // Without signing (backwards compatible):
 * new RedisDriver(redis, 'session', 86400)
 *
 * // With HMAC signing (recommended):
 * new RedisDriver(redis, 'session', 86400, Bun.env.SESSION_SECRET!)
 * ```
 *
 * @see {@link SessionDriver} — the interface this implements.
 */
export class RedisDriver implements SessionDriver {
  /**
   * @param redis - Connected Bun `RedisClient` used for storage.
   * @param cookieName - Name of the cookie carrying the session ID. Defaults
   * to `"session"`.
   * @param ttl - Redis key TTL / cookie `Max-Age` in seconds. Defaults to
   * `86400` (24h).
   * @param secret - Optional HMAC secret; when set, cookie IDs are signed and
   * verified before any Redis lookup. Omit to trust the raw cookie ID.
   */
  constructor(
    private readonly redis: RedisClient,
    readonly cookieName: string = "session",
    private readonly ttl: number = 86_400,
    private readonly secret?: string,
  ) {}

  /**
   * Read the (optionally signed) session ID from the cookie, then load its data
   * from Redis under `session:{id}`. A missing cookie, a failed signature, or an
   * unparseable value all yield a session with empty data.
   * @param request - Request carrying the session-ID cookie.
   */
  async loadFromRequest(request: Request): Promise<SessionPayload> {
    const raw = this._readCookie(request);

    let id: string;
    if (!raw) {
      // No cookie present — start a fresh session
      id = crypto.randomUUID();
    } else if (this.secret) {
      // Verify HMAC signature before touching Redis.
      // A forged/replayed cookie returns null → fresh session, no Redis hit.
      id = _verifyId(raw, this.secret) ?? crypto.randomUUID();
    } else {
      // No secret configured — fall back to trusting the raw cookie value
      id = raw;
    }

    const stored = await this.redis.get(`session:${id}`);
    if (!stored) return { id, data: {} };
    try {
      return { id, data: JSON.parse(stored) as Record<string, unknown> };
    } catch {
      return { id, data: {} };
    }
  }

  /**
   * Write the session data to Redis (with TTL) and set the cookie to the ID —
   * signed when a `secret` is configured, raw otherwise.
   */
  async saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void> {
    await this.redis.set(`session:${id}`, JSON.stringify(data), "EX", this.ttl);

    // When signing is enabled, the client receives the signed form.
    // On the next request, _verifyId strips the signature before the Redis lookup.
    const cookieId = this.secret ? _signId(id, this.secret) : id;

    const cookie = buildCookie({
      name: this.cookieName,
      value: cookieId,
      maxAge: this.ttl,
    });
    response.headers.append("Set-Cookie", cookie);
  }

  /**
   * Delete a session's Redis record. Called by {@link SessionMiddleware} for IDs
   * abandoned by {@link SessionManager.regenerate} so they cannot be replayed.
   * @param id - Session ID whose `session:{id}` key is removed.
   */
  async destroy(id: string): Promise<void> {
    await this.redis.del(`session:${id}`);
  }

  /** @internal Read the raw session-ID cookie value from the request. */
  private _readCookie(request: Request): string | undefined {
    return readCookie(request, this.cookieName);
  }
}
