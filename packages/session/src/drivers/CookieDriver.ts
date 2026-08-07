import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { buildCookie, readCookie } from "@zerotal/core";
import { SessionCookieOverflowError, SessionSecretMissingError } from "../errors.ts";

/**
 * The result of loading a session: its ID and decoded data map.
 */
export interface SessionPayload {
  /** Session ID (a fresh UUID when no valid session was found). */
  id: string;
  /** Decoded session data; `{}` for a new or unreadable session. */
  data: Record<string, unknown>;
}

/**
 * Contract every session backend implements.
 *
 * A driver is responsible for reading a session out of the incoming request and
 * writing it back onto the outgoing response. {@link SessionMiddleware} calls
 * {@link loadFromRequest} before the pipeline and {@link saveSession} after it.
 * Implementations decide where data lives — inside the (encrypted) cookie
 * ({@link CookieDriver}) or server-side keyed by a cookie ID ({@link RedisDriver}).
 *
 * @see {@link CookieDriver}
 * @see {@link RedisDriver}
 */
export interface SessionDriver {
  /**
   * Read and decode the session for an incoming request. Must return a fresh
   * payload (new UUID, empty data) when no valid session cookie is present.
   * @param request - The incoming request to read the session cookie from.
   */
  loadFromRequest(request: Request): Promise<SessionPayload>;
  /**
   * Persist the session for `id` and attach the appropriate `Set-Cookie` header
   * to the response.
   * @param id - Session ID to save under.
   * @param data - The session data to persist.
   * @param response - Response to append the session cookie to.
   */
  saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void>;
  /**
   * Remove a session's server-side record (e.g. its Redis key). Optional:
   * pure client-side drivers like {@link CookieDriver} store nothing on the
   * server. Called by SessionMiddleware for IDs abandoned by `regenerate()`,
   * so a pre-regeneration session cannot be replayed until its TTL expires.
   */
  destroy?(id: string): Promise<void>;
}

/** AES-256-GCM layout constants — identical to @zerotal/core's Crypt. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Browsers cap a single cookie (name + value + attributes) at 4096 bytes
 * (RFC 6265 §6.1) and silently truncate or drop anything larger — which would
 * corrupt or lose the session. We refuse to emit such a cookie instead.
 */
const MAX_COOKIE_BYTES = 4096;

/**
 * Reserved data key carrying the session's original issue time (epoch seconds).
 *
 * It rides in the data bag because that is the only thing a driver gets handed back on
 * save — the {@link SessionDriver} contract passes `(id, data, response)` and nothing
 * else — so it is how "when did this session first exist?" survives a round trip and
 * makes {@link CookieDriver}'s absolute lifetime enforceable.
 */
export const SESSION_ISSUED_AT_KEY = "_iat";

/**
 * Default absolute session lifetime: 14 days.
 *
 * `maxAge` is a *sliding* window — every request refreshes it — so on its own it never
 * expires a session that is being actively used, including by an attacker holding a
 * captured cookie. This is the ceiling that does, measured from first issue and unaffected
 * by activity.
 */
const DEFAULT_ABSOLUTE_MAX_AGE = 60 * 60 * 24 * 14;

/**
 * Cookie-based session driver.
 *
 * Stores the session ID and all data in a single **encrypted** cookie:
 * base64url( IV ‖ GCM tag ‖ AES-256-GCM ciphertext of JSON({id, data}) ),
 * the same primitive (and layout) as `Crypt` in @zerotal/core, keyed off this
 * driver's secret via SHA-256.
 *
 * AES-256-GCM is *authenticated* encryption, so this replaces the previous
 * sign-only (HMAC) format with a strict upgrade:
 *  - Confidential — session contents are no longer client-readable. Signed
 *    base64 could be decoded by anyone holding the cookie (user IDs, flash
 *    data, anything a controller put in the session).
 *  - Authenticated — tampered or truncated cookies fail decryption; there is
 *    no separate signature to compare, hence no comparison to get wrong.
 *
 * Backward compatibility: cookies written by the old signed-only format fail
 * to decrypt and are treated as an absent session (a fresh one is started) —
 * the standard practice when rotating cookie formats or keys.
 *
 * Size: the serialized cookie must stay within the 4096-byte browser limit;
 * `saveSession` throws {@link SessionCookieOverflowError} instead of emitting
 * a cookie the browser would truncate or drop.
 */
export class CookieDriver implements SessionDriver {
  /** @internal 32-byte AES key derived from the secret (SHA-256, like Crypt). */
  private readonly _key: Buffer;

  /**
   * @param secret - Signing/encryption secret. A `base64:`-prefixed value is
   * base64-decoded first (same rule as core `Crypt`). Must be non-empty.
   * @param cookieName - Name of the session cookie. Defaults to `"session"`.
   * @param maxAge - Idle lifetime in seconds, applied as both the cookie `Max-Age` and the
   *   envelope's `exp`. Sliding: refreshed on every save. Defaults to `86400` (24h).
   * @param secure - Set the `Secure` flag on the cookie. Defaults to `false`.
   * @param absoluteMaxAge - Hard lifetime in seconds from first issue, regardless of
   *   activity. Defaults to 14 days. Pass `0` to disable (not recommended — a cookie
   *   session has no server-side record to revoke, so this is its only forced end).
   * @throws {@link SessionSecretMissingError} when `secret` is empty.
   */
  constructor(
    private readonly secret: string,
    readonly cookieName: string = "session",
    private readonly maxAge: number = 86_400,
    private readonly secure: boolean = false,
    private readonly absoluteMaxAge: number = DEFAULT_ABSOLUTE_MAX_AGE,
  ) {
    if (!secret) {
      throw new SessionSecretMissingError();
    }
    // Same derivation as Crypt: any secret length works, `base64:` prefix honoured.
    const raw = secret.startsWith("base64:")
      ? Buffer.from(secret.slice(7), "base64")
      : Buffer.from(secret, "utf8");
    this._key = Buffer.from(new Bun.CryptoHasher("sha256").update(raw).digest());
  }

  /**
   * Decrypt the session cookie into a {@link SessionPayload}. Any failure —
   * missing cookie, tampering, truncation, a rotated secret, an expired envelope, or a
   * legacy signed-only cookie — yields a fresh session rather than an error.
   *
   * Expiry is enforced here, on the server, not left to the browser's `Max-Age`. A cookie
   * session has no server-side record, so the envelope's own `exp` and `iat` are the only
   * thing standing between a captured cookie and an indefinitely valid credential; a client
   * that simply keeps replaying the cookie past its `Max-Age` gets nothing.
   *
   * @param request - Request whose session cookie is read.
   */
  async loadFromRequest(request: Request): Promise<SessionPayload> {
    const raw = this._readCookie(request);
    if (!raw) return this._fresh();

    // Decryption failure covers every bad case at once: tampering, truncation,
    // a rotated secret, or a legacy signed-only cookie → start a fresh session.
    const json = this._decrypt(raw);
    if (json === null) return this._fresh();

    let parsed: Partial<SessionPayload> & { exp?: unknown; iat?: unknown };
    try {
      parsed = JSON.parse(json) as typeof parsed;
    } catch {
      return this._fresh();
    }

    const now = Math.floor(Date.now() / 1000);

    // Idle window. A missing or non-numeric `exp` is an envelope this driver did not
    // write, so it is rejected rather than read as an eternal session.
    if (typeof parsed.exp !== "number" || now >= parsed.exp) return this._fresh();

    // Absolute window, measured from first issue and immune to refresh.
    const iat = typeof parsed.iat === "number" ? parsed.iat : null;
    if (this.absoluteMaxAge > 0) {
      if (iat === null || now - iat >= this.absoluteMaxAge) return this._fresh();
    }

    const data = typeof parsed.data === "object" && parsed.data !== null ? parsed.data : {};
    if (iat !== null) data[SESSION_ISSUED_AT_KEY] = iat;

    return {
      id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
      data,
    };
  }

  /**
   * Encrypt `{ id, data, iat, exp }` and append it as the session cookie.
   *
   * `exp` slides forward by `maxAge` on every save; `iat` is carried through from the
   * original issue (see {@link SESSION_ISSUED_AT_KEY}) so refreshing cannot extend the
   * session past `absoluteMaxAge`.
   *
   * @throws {@link SessionCookieOverflowError} when the serialized cookie
   * exceeds the 4096-byte browser limit.
   */
  async saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const carried = data[SESSION_ISSUED_AT_KEY];
    const iat = typeof carried === "number" ? carried : now;
    const value = this._encrypt(JSON.stringify({ id, data, iat, exp: now + this.maxAge }));
    const cookie = buildCookie({
      name: this.cookieName,
      value,
      maxAge: this.maxAge,
      secure: this.secure,
    });

    const size = Buffer.byteLength(cookie);
    if (size > MAX_COOKIE_BYTES) {
      throw new SessionCookieOverflowError(size, MAX_COOKIE_BYTES);
    }

    response.headers.append("Set-Cookie", cookie);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** @internal Build a brand-new empty session payload. */
  private _fresh(): SessionPayload {
    return { id: crypto.randomUUID(), data: {} };
  }

  /** @internal AES-256-GCM encrypt → base64url(iv ‖ tag ‖ ciphertext), cookie-safe. */
  private _encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this._key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }

  /** @internal Decrypt a cookie value, or `null` when malformed/tampered/wrong-key. */
  private _decrypt(payload: string): string | null {
    let buf: Buffer;
    try {
      buf = Buffer.from(payload, "base64url");
    } catch {
      return null;
    }
    if (buf.length < IV_BYTES + TAG_BYTES) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this._key, buf.subarray(0, IV_BYTES));
      decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null; // GCM auth failure — tampered, truncated, or legacy format
    }
  }

  /** @internal Read the raw session cookie value from the request. */
  private _readCookie(request: Request): string | undefined {
    return readCookie(request, this.cookieName);
  }
}
