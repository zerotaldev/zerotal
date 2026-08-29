/**
 * Normalised user profile returned by every OAuth2 driver.
 */
export interface SocialUser {
  /** Provider-specific unique user ID (always a string). */
  id: string;
  /** Display name. */
  name: string;
  /** Primary email address (may be null if the provider doesn't share it). */
  email: string | null;
  /**
   * Whether the **provider** has verified that this account controls {@link email}.
   *
   * Check this before matching a social login onto an existing account by address. Most
   * providers let a user type any address into their profile, and an attacker who controls
   * a Workspace/Entra domain can create `victim@corp.com` outright — so find-or-create by
   * unverified email is an account-takeover path with the provider's name on it.
   *
   * `false` means "not asserted", not "known bad": a driver reports `true` only when the
   * provider makes an explicit verification claim (Google's `email_verified`, GitHub's
   * verified primary address). Providers that make no such claim always report `false`.
   */
  emailVerified: boolean;
  /** Avatar / profile picture URL. */
  avatar: string | null;
  /** Raw access token returned by the provider. */
  token: string;
  /**
   * Refresh token, when the provider issues one. Most providers only return a
   * refresh token when offline access is requested — e.g. Google requires
   * `.with({ access_type: 'offline' })`. `null` when the provider omits it.
   */
  refreshToken: string | null;
  /** Access-token lifetime in seconds, or `null` when the provider omits it. */
  expiresIn: number | null;
  /** Raw token data as returned by the provider (for custom fields). */
  raw: Record<string, unknown>;
}

/**
 * Per-provider OAuth2 credentials passed to a driver's constructor (and stored in
 * `config/social.ts`). `redirectUrl` must exactly match the callback URL
 * registered with the provider — the driver always uses it verbatim and never
 * derives it from the incoming request.
 */
export interface OAuth2Config {
  /** OAuth2 client / application ID issued by the provider. */
  clientId: string;
  /** Static client secret, or omit for Apple and supply teamId/keyId/privateKey instead. */
  clientSecret?: string | undefined;
  /** Fixed callback URL, matching the one registered with the provider. */
  redirectUrl: string;
  /** Scopes to request; when omitted the driver's `defaultScopes()` are used. */
  scopes?: string[] | undefined;
}

/**
 * Apple-specific config.  Supply either `clientSecret` (a pre-signed JWT) or
 * the three raw Apple credentials — the driver will sign the JWT automatically
 * using the Web Crypto API (no external dependency needed).
 */
export interface AppleOAuth2Config extends OAuth2Config {
  /** Your Apple Developer Team ID (10-character string). */
  teamId?: string | undefined;
  /** The Key ID of the private key created in App Store Connect. */
  keyId?: string | undefined;
  /**
   * PEM-encoded PKCS#8 ES256 private key downloaded from App Store Connect.
   * Include the full -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY----- block.
   */
  privateKey?: string | undefined;
}

// ── Internal driver types ─────────────────────────────────────────────────────

export interface SocialSession {
  set(key: string, value: unknown): void;
  get<T>(key: string): T | undefined;
  forget(key: string): void;
  regenerate?(): void;
}

/**
 * Minimal HttpContext shape used by driver internals and the protected
 * `_extractCodeAndState()` hook.  You no longer need to pass an HttpContext
 * to `redirect()` or `user()` — they read it from async-local storage.
 *
 * @internal
 */
export interface SocialHttpContext {
  request: {
    readonly method: string;
    readonly url: string;
    formData(): Promise<FormData>;
  };
  /** `ctx.redirect()` issues an HTTP redirect response. */
  redirect(url: string): void;
}
