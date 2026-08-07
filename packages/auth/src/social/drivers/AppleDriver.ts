/**
 * AppleDriver — Sign in with Apple.
 *
 * Quirks handled automatically by this driver:
 *
 * 1. `response_mode: form_post` — Apple sends `code` and `state` in a POST
 *    body, not query params.  `_extractCodeAndState()` detects POST and reads
 *    from `formData()` automatically.
 *
 * 2. `id_token` payload — Apple returns the user profile inside a signed JWT
 *    rather than from a user-info endpoint.  `_doUser()` decodes the JWT
 *    payload without making a second network request.
 *
 * 3. User profile is ONLY sent on the first login — store `name` and `email`
 *    immediately.  On every subsequent login the JWT payload omits them.
 *
 * 4. `clientSecret` is a signed ES256 JWT, not a static string.  Supply either:
 *    a) A pre-generated JWT as `clientSecret` in `config/social.ts`, OR
 *    b) Your raw Apple credentials (`teamId`, `keyId`, `privateKey`) and the
 *       driver will generate and refresh the JWT automatically using the Web
 *       Crypto API — no external dependency required.
 *
 * @see https://developer.apple.com/documentation/sign_in_with_apple
 * @category Providers
 */

import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser, SocialHttpContext, AppleOAuth2Config } from "../types.ts";
import { AppleClientSecretError, OAuthTokenExchangeError } from "../errors.ts";

export class AppleDriver extends OAuth2Driver {
  declare protected config: AppleOAuth2Config;

  constructor(config: AppleOAuth2Config) {
    super(config);
  }

  protected authUrl() {
    return "https://appleid.apple.com/auth/authorize";
  }
  protected tokenUrl() {
    return "https://appleid.apple.com/auth/token";
  }
  /** Apple returns the profile in the `id_token` JWT — no user-info endpoint. */
  protected userUrl() {
    return "";
  }

  protected defaultScopes() {
    return ["name", "email"];
  }
  protected override scopeSeparator() {
    return " ";
  }

  protected override extraAuthParams(): Record<string, string> {
    return { response_mode: "form_post" };
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["sub"] ?? ""),
      name: _nameFromRaw(raw),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      // Apple's ID token carries `email_verified`, serialised as a string on some responses.
      emailVerified: raw["email_verified"] === true || raw["email_verified"] === "true",
      avatar: null, // Apple doesn't provide an avatar
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }

  // ── Hook: read code/state from POST body for Apple's form_post ───────────────

  protected override async _extractCodeAndState(
    ctx: SocialHttpContext,
  ): Promise<{ code: string | null; state: string | null }> {
    if (ctx.request.method === "POST") {
      const form = await ctx.request.formData();
      return {
        code: form.get("code") as string | null,
        state: form.get("state") as string | null,
      };
    }
    // Fallback: some integrations test with GET
    const params = new URL(ctx.request.url).searchParams;
    return { code: params.get("code"), state: params.get("state") };
  }

  // ── Hook: decode id_token instead of calling a user-info endpoint ────────────

  protected override async _doUser(code: string, codeVerifier?: string): Promise<SocialUser> {
    const secret = await this._resolveClientSecret();
    const tokenData = await this._appleExchangeCode(code, secret, codeVerifier);
    const payload = _decodeJwtPayload(tokenData.id_token);
    const user = this.normalise(payload, tokenData.access_token);
    user.refreshToken = tokenData.refresh_token ?? null;
    user.expiresIn = tokenData.expires_in ?? null;
    return user;
  }

  // ── Apple JWT client-secret generation ───────────────────────────────────────

  /**
   * Returns the `clientSecret` JWT.  If `teamId`, `keyId`, and `privateKey`
   * are supplied, a new JWT is signed on demand using the Web Crypto API.
   * Otherwise falls back to the static `config.clientSecret` string.
   */
  private async _resolveClientSecret(): Promise<string> {
    const { teamId, keyId, privateKey, clientSecret, clientId } = this.config;

    if (teamId && keyId && privateKey) {
      return _signAppleJwt(teamId, keyId, privateKey, clientId);
    }

    if (clientSecret) return clientSecret;

    throw new AppleClientSecretError();
  }

  // ── Apple token exchange ─────────────────────────────────────────────────────

  private async _appleExchangeCode(
    code: string,
    clientSecret: string,
    codeVerifier?: string,
  ): Promise<{
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in?: number;
  }> {
    const body: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: clientSecret,
      redirect_uri: this.config.redirectUrl,
      code,
      grant_type: "authorization_code",
    };
    // PKCE (RFC 7636): completes the challenge sent on the authorize redirect.
    if (codeVerifier) body["code_verifier"] = codeVerifier;

    const res = await fetch(this.tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });

    if (!res.ok) {
      throw new OAuthTokenExchangeError(
        `[Social/Apple] Token exchange failed: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data["access_token"] !== "string" || typeof data["id_token"] !== "string") {
      throw new OAuthTokenExchangeError(
        "[Social/Apple] Token exchange: access_token or id_token missing",
      );
    }
    return data as {
      access_token: string;
      id_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new OAuthTokenExchangeError("[Social/Apple] Invalid id_token");
  const json = Buffer.from(parts[1]!, "base64url").toString("utf-8");
  return JSON.parse(json) as Record<string, unknown>;
}

function _nameFromRaw(raw: Record<string, unknown>): string {
  const n = raw["name"] as Record<string, unknown> | undefined;
  if (!n) return "";
  const first = typeof n["firstName"] === "string" ? n["firstName"] : "";
  const last = typeof n["lastName"] === "string" ? n["lastName"] : "";
  return [first, last].filter(Boolean).join(" ");
}

/**
 * Sign an Apple client-secret JWT using the Web Crypto API (no external dep).
 *
 * @param teamId    Apple Developer Team ID (10-char string)
 * @param keyId     Key ID from App Store Connect
 * @param pemKey    PEM-encoded PKCS#8 EC private key (P-256)
 * @param clientId  Apple Service / Bundle ID
 */
async function _signAppleJwt(
  teamId: string,
  keyId: string,
  pemKey: string,
  clientId: string,
): Promise<string> {
  // Strip PEM armor and decode DER bytes
  const b64 = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);

  const header = _b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = _b64url(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 15_777_000, // ~6 months; Apple's maximum
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  );

  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );

  return `${input}.${_b64url(new Uint8Array(signature))}`;
}

/** Encode a string or byte array as unpadded Base64url. */
function _b64url(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
