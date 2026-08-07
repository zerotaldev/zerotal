/**
 * OAuth2Driver — abstract base for all social login providers.
 *
 * Concrete drivers extend this class and implement:
 *  - `authUrl()`              → the provider's authorization endpoint
 *  - `tokenUrl()`             → the token exchange endpoint
 *  - `userUrl()`              → the user-info endpoint (empty string for Apple)
 *  - `normalise()`            → map the raw profile to SocialUser
 *  - `defaultScopes()`        → sensible default scopes for that provider
 *
 * Optional hooks for subclasses:
 *  - `extraAuthParams()`      → extra params appended to the auth redirect URL
 *  - `afterNormalise()`       → post-process the normalised user (e.g. GitHub email)
 *  - `_doUser(code)`          → override the full code→user flow (Apple id_token)
 *  - `_extractCodeAndState()` → override code/state extraction (Apple form_post)
 */

import type { OAuth2Config, SocialUser, SocialHttpContext, SocialSession } from "../types.ts";
import { RequestContext, safeEqual } from "@zerotal/core";
import {
  OAuthStateMismatchError,
  OAuthMissingCodeError,
  SocialContextUnavailableError,
  OAuthTokenExchangeError,
  OAuthUserFetchError,
} from "../errors.ts";

/** Tokens returned by an OAuth2 code-for-token exchange. */
export interface TokenBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

/**
 * Abstract base for every social-login provider driver.
 *
 * A driver turns a provider's OAuth2 authorization-code flow into a normalized
 * {@link SocialUser}. The two calls an app makes are {@link redirect} (send the
 * user to the provider) and {@link user} (handle the callback); everything in
 * between — CSRF `state`, PKCE, token exchange, profile fetch — is handled here.
 *
 * @remarks
 * **PKCE (RFC 7636, S256) is on by default** ({@link usesPKCE}). {@link redirect}
 * generates a `code_verifier`, stores it in the session, and sends only its S256
 * `code_challenge` to the provider; {@link user} replays the verifier during token
 * exchange. A stolen authorization code is therefore useless without the
 * session-bound verifier. Providers that don't support PKCE ignore the extra
 * params.
 *
 * **CSRF `state`** is a random UUID written to the session by {@link redirect} and
 * verified (constant-time) against the callback's `state` by {@link user}. Both the
 * state and the PKCE verifier are single-use: {@link user} consumes and forgets
 * them from the session so they can never be replayed on a later callback.
 *
 * **`redirect_uri` is fixed** from `config.redirectUrl` — it is never taken from
 * the request, so it can't be tampered with.
 *
 * Both {@link redirect} and {@link user} read the current `HttpContext` from
 * async-local storage; nothing needs to be passed explicitly. For flows with no
 * request (mobile/SPA), use {@link stateless} + `user(rawCode)` or
 * {@link userFromToken}.
 *
 * Concrete drivers implement the provider endpoints and profile mapping:
 * {@link authUrl}, {@link tokenUrl}, {@link userUrl}, {@link normalise},
 * {@link defaultScopes}, with optional hooks {@link extraAuthParams},
 * {@link afterNormalise}, {@link _doUser}, {@link _extractCodeAndState}.
 *
 * @example
 * ```ts
 * import { Social } from "@zerotal/auth";
 *
 * // Step 1 — send the user to GitHub (stores state + PKCE verifier in session):
 * async redirect() {
 *   return Social.driver("github").redirect();
 * }
 *
 * // Step 2 — handle the callback (verifies state, exchanges the code):
 * async callback() {
 *   const socialUser = await Social.driver("github").user();
 *   // socialUser.id, .name, .email, .avatar, .token …
 *   // find-or-create your app user, then log them in.
 * }
 * ```
 */
export abstract class OAuth2Driver {
  protected config: OAuth2Config;
  private _isStateless = false;
  private _scopesOverride: string[] | undefined = undefined;
  private _withParams: Record<string, string> = {};

  constructor(config: OAuth2Config) {
    this.config = config;
  }

  // ── Subclass contract ────────────────────────────────────────────────────────

  protected abstract authUrl(): string;
  protected abstract tokenUrl(): string;
  protected abstract userUrl(): string;
  protected abstract normalise(raw: Record<string, unknown>, token: string): SocialUser;
  protected abstract defaultScopes(): string[];

  /** Extra query parameters appended to the authorization redirect URL. */
  protected extraAuthParams(): Record<string, string> {
    return {};
  }

  /** Separator used to join scope values. Default: space. */
  protected scopeSeparator(): string {
    return " ";
  }

  /**
   * Whether to include `response_type=code` in the authorization URL.
   * Most providers require it; GitHub does not accept it and returns 404.
   * Override to return `false` for providers that omit it.
   */
  protected includeResponseType(): boolean {
    return true;
  }

  /**
   * Whether to use PKCE (RFC 7636, S256) on the authorization-code flow.
   * Default `true`: a stolen authorization code cannot be exchanged without
   * the per-flow `code_verifier` held in the session, and providers that do
   * not support PKCE simply ignore the extra parameters. Override to return
   * `false` for a provider that rejects unknown params.
   */
  protected usesPKCE(): boolean {
    return true;
  }

  /**
   * Called after `normalise()` — override to enrich the user object (e.g. fetch
   * a secondary endpoint).  Default: returns the user unchanged.
   */
  protected async afterNormalise(user: SocialUser, _token: string): Promise<SocialUser> {
    return user;
  }

  /**
   * Override to change how `code` and `state` are extracted from the incoming
   * request.  Default: reads `?code=&state=` from the query string.
   *
   * This is an internal hook called by `user()` — it receives the `HttpContext`
   * resolved from async-local storage.  Apple overrides this to read from a
   * POST form body instead.
   */
  protected async _extractCodeAndState(
    ctx: SocialHttpContext,
  ): Promise<{ code: string | null; state: string | null }> {
    const params = new URL(ctx.request.url).searchParams;
    return { code: params.get("code"), state: params.get("state") };
  }

  /**
   * Override to change the full code→SocialUser pipeline.
   * Apple overrides this to decode an `id_token` JWT instead of calling a
   * user-info endpoint.
   */
  protected async _doUser(code: string, codeVerifier?: string): Promise<SocialUser> {
    const tokens = await this._exchangeCode(code, codeVerifier);
    const raw = await this._fetchRaw(tokens.accessToken);
    const user = this.normalise(raw, tokens.accessToken);
    user.refreshToken = tokens.refreshToken;
    user.expiresIn = tokens.expiresIn;
    return this.afterNormalise(user, tokens.accessToken);
  }

  /**
   * Retrieve a user's profile from an access token you already hold — e.g. a
   * native/mobile app that obtained the token via its own SDK. Skips the
   * code-exchange step entirely; the returned user carries no refresh token or
   * expiry (those come from exchange).
   *
   * ```ts
   * const socialUser = await Social.driver('github').userFromToken(accessToken);
   * ```
   *
   * @param token - An access token already obtained out-of-band (e.g. a mobile SDK).
   * @returns The normalized profile for that token.
   * @throws {OAuthUserFetchError} If the provider's user-info request fails.
   * @category Callback
   */
  async userFromToken(token: string): Promise<SocialUser> {
    const raw = await this._fetchRaw(token);
    const user = this.normalise(raw, token);
    return this.afterNormalise(user, token);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Return a shallow copy of this driver with CSRF state verification disabled.
   *
   * Use this for stateless API/mobile endpoints that receive a raw `code`
   * directly (no session, no state param):
   *
   * ```ts
   * const socialUser = await Social.driver('google').stateless().user(rawCode);
   * ```
   *
   * A copy is returned so the registered singleton is never mutated.
   *
   * @category Configuration
   */
  stateless(): this {
    const copy = this._clone();
    copy._isStateless = true;
    return copy;
  }

  /**
   * Add scopes to the authorization request, merged with the default/configured
   * scopes. Returns a copy so the registered singleton is never mutated.
   *
   * ```ts
   * Social.driver('github').scopes(['read:user', 'public_repo']).redirect();
   * ```
   *
   * @category Configuration
   */
  scopes(scopes: string[]): this {
    const copy = this._clone();
    copy._scopesOverride = [...new Set([...this._currentScopes(), ...scopes])];
    return copy;
  }

  /**
   * Replace all scopes on the authorization request. Returns a copy so the
   * registered singleton is never mutated.
   *
   * @category Configuration
   */
  setScopes(scopes: string[]): this {
    const copy = this._clone();
    copy._scopesOverride = [...new Set(scopes)];
    return copy;
  }

  /**
   * Append optional parameters to the authorization redirect URL. Useful for
   * provider-specific options such as Google's
   * `access_type=offline` + `prompt=consent` (required to receive a refresh
   * token) or `hd` for hosted-domain restriction.
   *
   * Do not pass reserved keys (`client_id`, `redirect_uri`, `scope`, `state`,
   * `response_type`) — those are managed by the driver. Returns a copy.
   *
   * ```ts
   * Social.driver('google')
   *   .with({ access_type: 'offline', prompt: 'consent' })
   *   .redirect();
   * ```
   *
   * @category Configuration
   */
  with(params: Record<string, string>): this {
    const copy = this._clone();
    copy._withParams = { ...this._withParams, ...params };
    return copy;
  }

  /** Scopes currently in effect: fluent override → config → driver defaults. */
  private _currentScopes(): string[] {
    return this._scopesOverride ?? this.config.scopes ?? this.defaultScopes();
  }

  /**
   * Shallow copy preserving the prototype, so fluent builders return a fresh
   * instance instead of mutating the shared registered singleton.
   */
  private _clone(): this {
    return Object.assign(
      Object.create(Object.getPrototypeOf(this) as object) as object,
      this,
    ) as this;
  }

  /**
   * Build the full authorization URL (for low-level use or testing).
   * Prefer `redirect()` in controllers.
   *
   * When a PKCE `codeVerifier` is supplied, its S256 challenge is sent as
   * `code_challenge` + `code_challenge_method` (RFC 7636 §4.3).
   *
   * @param state - The CSRF state token to embed in the URL.
   * @param codeVerifier - Optional PKCE verifier; when present its S256 challenge is sent.
   * @returns The fully-built authorization URL.
   * @category Redirect
   */
  redirectUrl(state: string, codeVerifier?: string): string {
    const scopes = this._currentScopes().join(this.scopeSeparator());

    const base: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUrl,
      scope: scopes,
      state,
    };
    if (this.includeResponseType()) {
      base["response_type"] = "code";
    }
    if (codeVerifier) {
      base["code_challenge"] = _pkceChallenge(codeVerifier);
      base["code_challenge_method"] = "S256";
    }
    // Precedence: driver base params < driver's extraAuthParams() < per-call with().
    const params = new URLSearchParams({
      ...base,
      ...this.extraAuthParams(),
      ...this._withParams,
    });

    return `${this.authUrl()}?${params}`;
  }

  /**
   * Generate a CSRF state token, store it in the session, and redirect the
   * user to the provider's authorization page.
   *
   * The current HTTP context is read automatically from async-local storage —
   * no need to pass it explicitly:
   *
   * ```ts
   * async redirect({ params }: HttpContext) {
   *   return Social.driver(params.provider).redirect();
   * }
   * ```
   *
   * @throws {SocialContextUnavailableError} If called outside an HTTP request; use
   *   `.stateless().user(code)` for request-less flows.
   * @category Redirect
   */
  redirect(): void {
    const ctx = this._requireContext();
    const state = crypto.randomUUID();
    const session = _session(ctx);
    session?.set("oauth_state", state);

    // PKCE (RFC 7636): keep the verifier server-side in the session; only its
    // S256 challenge travels to the provider. An attacker who steals the
    // authorization code from the redirect cannot exchange it without the
    // verifier. Skipped when no session is available (nothing to hold it).
    let codeVerifier: string | undefined;
    if (this.usesPKCE() && session) {
      codeVerifier = _pkceVerifier();
      session.set("oauth_pkce_verifier", codeVerifier);
    }

    ctx.redirect(this.redirectUrl(state, codeVerifier));
  }

  /**
   * Handle the OAuth2 callback, or exchange a raw code in stateless mode.
   *
   * **Stateful (session-based):** call with no arguments — the driver reads the
   * current `HttpContext` from async-local storage, extracts `code` + `state`,
   * verifies state against the session, then exchanges the code for a profile:
   *
   * ```ts
   * async callback({ params }: HttpContext) {
   *   const socialUser = await Social.driver(params.provider).user();
   * }
   * ```
   *
   * **Stateless (SPA / mobile):** call with the raw code — skips session/state
   * verification entirely:
   *
   * ```ts
   * const socialUser = await Social.driver('github').stateless().user(rawCode);
   * ```
   *
   * Throws `Error('invalid_state')` or `Error('missing_code')` on validation
   * failure — catch in your controller and redirect accordingly.
   *
   * @param code - Optional raw authorization code for stateless flows; omit for
   *   the stateful session-based callback.
   * @returns The normalized {@link SocialUser} for the authenticated account.
   * @throws {OAuthStateMismatchError} When the callback `state` is missing or mismatched.
   * @throws {OAuthMissingCodeError} When no authorization code is present.
   * @throws {OAuthTokenExchangeError} When the provider's token exchange fails.
   * @category Callback
   */
  async user(code?: string): Promise<SocialUser> {
    if (code !== undefined) {
      // Stateless: code provided directly (mobile / SPA flow).
      return this._doUser(code);
    }

    // Stateful: read request context from ALS.
    const ctx = this._requireContext();
    const { code: extracted, state } = await this._extractCodeAndState(ctx);

    let codeVerifier: string | undefined;
    if (!this._isStateless) {
      const session = _session(ctx);
      const savedState = session?.get<string>("oauth_state");
      session?.forget("oauth_state");

      // Single-use PKCE verifier stored by redirect(); always consumed so it
      // can never be replayed on a later callback.
      codeVerifier = session?.get<string>("oauth_pkce_verifier") ?? undefined;
      session?.forget("oauth_pkce_verifier");

      if (!state || !savedState || !safeEqual(state, savedState)) {
        throw new OAuthStateMismatchError();
      }
    }

    if (!extracted) {
      throw new OAuthMissingCodeError();
    }

    return this._doUser(extracted, codeVerifier);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve the current HTTP context from async-local storage.
   * Throws a descriptive error if called outside a request (e.g. in a queue job).
   * Use `.stateless().user(code)` for flows that don't have an active request.
   */
  private _requireContext(): SocialHttpContext {
    const ctx = RequestContext.tryGet();
    if (!ctx) {
      throw new SocialContextUnavailableError();
    }
    return ctx as unknown as SocialHttpContext;
  }

  protected async _exchangeCode(code: string, codeVerifier?: string): Promise<TokenBundle> {
    const body: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret ?? "",
      redirect_uri: this.config.redirectUrl,
      code,
      grant_type: "authorization_code",
    };
    // PKCE (RFC 7636 §4.5): prove possession of the verifier whose challenge was
    // sent on the authorize request. Only included when a verifier is supplied.
    if (codeVerifier) body["code_verifier"] = codeVerifier;

    const res = await fetch(this.tokenUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body),
    });

    if (!res.ok) {
      throw new OAuthTokenExchangeError(
        `[Social] Token exchange failed: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const token = data["access_token"];
    if (typeof token !== "string") {
      throw new OAuthTokenExchangeError(
        "[Social] Token exchange: access_token missing in response",
      );
    }
    return {
      accessToken: token,
      refreshToken: typeof data["refresh_token"] === "string" ? data["refresh_token"] : null,
      expiresIn: typeof data["expires_in"] === "number" ? data["expires_in"] : null,
    };
  }

  protected async _fetchRaw(token: string): Promise<Record<string, unknown>> {
    const url = this.userUrl();
    if (!url) return {};

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!res.ok) {
      throw new OAuthUserFetchError(
        `[Social] User fetch failed: ${res.status} ${await res.text()}`,
      );
    }

    return res.json() as Promise<Record<string, unknown>>;
  }
}

// ── Session helper ────────────────────────────────────────────────────────────

function _session(ctx: SocialHttpContext): SocialSession | undefined {
  return (ctx as unknown as { session?: SocialSession }).session;
}

// ── PKCE helpers (RFC 7636) ─────────────────────────────────────────────────────

/**
 * Generate a PKCE `code_verifier`: 32 random bytes, base64url-encoded (43 chars,
 * all from the unreserved set), meeting the RFC 7636 §4.1 length requirement.
 */
function _pkceVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Derive the S256 `code_challenge` for a verifier: base64url(SHA-256(verifier))
 * (RFC 7636 §4.2). The verifier stays server-side; only this challenge is sent.
 */
function _pkceChallenge(verifier: string): string {
  return Buffer.from(new Bun.CryptoHasher("sha256").update(verifier).digest()).toString(
    "base64url",
  );
}
