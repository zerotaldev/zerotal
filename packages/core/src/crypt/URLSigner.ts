import { safeEqual, hmacHex } from "../support/crypto.ts";

/**
 * URLSigner — generate and verify HMAC-signed URLs.
 *
 * Signed URLs carry a `signature` and `expires` query parameter.  The
 * signature is HMAC-SHA256(secret, canonicalPayload) where the payload is
 * the full URL (without the signature param) sorted by key so that the
 * order of other query parameters doesn't matter.
 *
 * For app-key-keyed signing without managing a secret, prefer the {@link Url}
 * facade (`Url.sign` / `Url.verify`), which derives the secret from `APP_KEY`.
 *
 * @example
 * ```ts
 * const signer = new URLSigner(process.env.APP_KEY!);
 *
 * // Generate a link that expires in 15 minutes:
 * const url = signer.sign("https://app.example.com/auth/verify", {
 *   email: "user@example.com",
 * }, 15);
 *
 * // Verify later:
 * const ok = signer.verify(url); // true while unexpired and untampered
 * ```
 */
export class URLSigner {
  /**
   * @param secret - HMAC signing secret (e.g. `APP_KEY`); must be non-empty.
   * @throws {Error} When `secret` is empty.
   */
  constructor(private readonly secret: string) {
    if (!secret) throw new Error("[URLSigner] secret must be a non-empty string");
  }

  /**
   * Build a signed URL.
   *
   * @param base  The base URL (scheme + host + path).
   * @param params  Extra query parameters to include (will be encoded).
   * @param expiresInMinutes  Minutes until the link expires. Default 60.
   * @returns The URL with `expires` and `signature` query parameters appended.
   */
  sign(base: string, params: Record<string, string> = {}, expiresInMinutes: number = 60): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;

    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("expires", String(expiresAt));

    const signature = this._hmac(this._canonical(url));
    url.searchParams.set("signature", signature);
    return url.toString();
  }

  /**
   * Verify a signed URL.
   * Returns `true` if the signature is valid and the link has not expired.
   */
  verify(signedUrl: string): boolean {
    try {
      const url = new URL(signedUrl);

      const signature = url.searchParams.get("signature");
      const expires = url.searchParams.get("expires");
      if (!signature || !expires) return false;

      // Check expiry first (cheap)
      if (Math.floor(Date.now() / 1000) > Number(expires)) return false;

      // Rebuild the URL without the signature to get the canonical payload
      const clone = new URL(signedUrl);
      clone.searchParams.delete("signature");
      const expected = this._hmac(this._canonical(clone));

      return safeEqual(signature, expected);
    } catch {
      return false;
    }
  }

  /**
   * Canonical form: sort all params alphabetically so order doesn't matter.
   */
  private _canonical(url: URL): string {
    const clone = new URL(url.toString());
    const sorted = [...clone.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    clone.search = "";
    for (const [k, v] of sorted) clone.searchParams.append(k, v);
    return clone.toString();
  }

  private _hmac(payload: string): string {
    return hmacHex(payload, this.secret);
  }
}
