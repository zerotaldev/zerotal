/**
 * Minimal HS256 JSON Web Tokens — sign and verify stateless tokens with no
 * external dependency (HMAC-SHA256 via `Bun.CryptoHasher`). Suitable for API
 * access tokens; pair with {@link JwtGuardMiddleware} to authenticate requests.
 *
 * @remarks
 * The algorithm is **pinned to HS256**: {@link Jwt.verify} reads the header and
 * rejects any other `alg` (notably `alg: "none"`) before checking the signature,
 * foreclosing algorithm-confusion attacks. Signatures are compared in constant
 * time via `safeEqual`, and an `exp` claim (when present) is enforced. There is
 * no revocation list — a signed token is valid until it expires, so keep
 * lifetimes short and rotate the secret to invalidate outstanding tokens.
 *
 * @example
 * ```ts
 * import { Jwt } from "@zerotal/auth";
 *
 * const token = Jwt.sign({ sub: user.id, role: "admin" }, secret, { expiresIn: 3600 });
 * const claims = Jwt.verify<{ sub: number; role: string }>(token, secret);
 * if (claims) {
 *   // claims.sub, claims.role — trusted
 * }
 * // verify() returns null when the token is malformed, tampered, wrong-secret, or expired
 * ```
 * @packageDocumentation
 */
import { safeEqual } from "@zerotal/core";

export interface JwtSignOptions {
  /** Token lifetime in seconds. Sets the `exp` claim when provided. */
  expiresIn?: number;
  /** Issued-at override (unix seconds). Defaults to now. */
  issuedAt?: number;
}

export type JwtPayload = Record<string, unknown>;

/** @internal Base64url-encode a string or byte array (JWT segment encoding). */
function _b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes).toString("base64url");
}

/** @internal Compute the base64url HMAC-SHA256 signature of `data` under `secret`. */
function _sign(data: string, secret: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(data).digest("base64url");
}

export const Jwt = {
  /**
   * Sign a payload into a compact HS256 JWT. A numeric `iat` is always added; an
   * `exp` is added when `expiresIn` is given.
   *
   * @param payload - Claims to embed. `iat` (and `exp`, if `expiresIn` is set) are
   *   added/overwritten by this method.
   * @param secret - The HMAC secret; the same value must be supplied to {@link verify}.
   * @param options - Optional `expiresIn` (seconds) and `issuedAt` (unix seconds) override.
   * @returns The compact `header.body.signature` token string.
   */
  sign(payload: JwtPayload, secret: string, options: JwtSignOptions = {}): string {
    const iat = options.issuedAt ?? Math.floor(Date.now() / 1000);
    const claims: JwtPayload = { ...payload, iat };
    if (options.expiresIn !== undefined) claims["exp"] = iat + options.expiresIn;

    const header = _b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = _b64url(JSON.stringify(claims));
    const signature = _sign(`${header}.${body}`, secret);
    return `${header}.${body}.${signature}`;
  },

  /**
   * Verify a token's algorithm, signature, and expiry, returning its claims, or
   * `null` when the token is malformed, uses a non-HS256 `alg`, is tampered,
   * signed with the wrong secret, or expired.
   *
   * @remarks
   * Never throws — every failure mode (bad structure, unparseable header/body,
   * wrong `alg`, signature mismatch, elapsed `exp`) is folded into a `null`
   * return, so callers only branch on the result. The `alg` check happens before
   * signature verification to foreclose algorithm-confusion / `alg: none` attacks.
   *
   * @typeParam T - The expected claims shape; the result is cast to `T` on success.
   * @param token - The compact JWT string to verify.
   * @param secret - The HMAC secret the token was signed with.
   * @returns The decoded claims on success, otherwise `null`.
   */
  verify<T extends JwtPayload = JwtPayload>(token: string, secret: string): T | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts as [string, string, string];

    // Pin the algorithm: only HS256 is issued here, so reject any other `alg`
    // (notably `none`) before verifying. Recomputing an HS256 MAC already stops
    // an attacker forging a valid signature, but pinning fails such tokens fast
    // and forecloses algorithm-confusion attacks if asymmetric algs are ever added.
    let head: { alg?: unknown; typ?: unknown };
    try {
      head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as typeof head;
    } catch {
      return null;
    }
    if (head.alg !== "HS256") return null;

    // Constant-time compare (shared helper) — a `===` here would leak how many
    // signature bytes match through timing.
    const expected = _sign(`${header}.${body}`, secret);
    if (!safeEqual(expected, signature)) return null;

    let claims: JwtPayload;
    try {
      claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
    } catch {
      return null;
    }

    const exp = claims["exp"];
    if (typeof exp === "number" && Math.floor(Date.now() / 1000) >= exp) return null;

    return claims as T;
  },
};
