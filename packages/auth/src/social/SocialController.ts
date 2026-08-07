/**
 * SocialController — built-in redirect + callback handler for OAuth2 social login.
 *
 * Registered automatically by SocialProvider when you supply a `handleCallback`
 * function.  You never instantiate this class yourself.
 *
 * Routes registered:
 *   GET  /auth/:provider           → redirect to provider
 *   GET  /auth/:provider/callback  → handle callback (GitHub, Google, …)
 *   POST /auth/:provider/callback  → handle callback (Apple form_post)
 *
 * Override the route prefix via SocialProvider.withConfig(config, { prefix: '/login' }).
 */

import type { HttpContext } from "@zerotal/core";
import { SocialManager } from "./SocialManager.ts";
import { OAuthStateMismatchError, OAuthMissingCodeError } from "./errors.ts";

export class SocialController {
  private readonly _manager: SocialManager;
  private readonly _handleCallback: SocialCallbackFn;
  private readonly _errorRedirect: string;

  constructor(manager: SocialManager, handleCallback: SocialCallbackFn, errorRedirect: string) {
    this._manager = manager;
    this._handleCallback = handleCallback;
    this._errorRedirect = errorRedirect;
  }

  // ── Step 1: Redirect to provider ────────────────────────────────────────────

  /**
   * Send the user to the provider.
   *
   * Delegates to the driver's own `redirect()` rather than building the URL here, so the
   * built-in routes get the full stateful flow: a PKCE verifier stashed in the session and
   * only its S256 challenge on the wire. Composing the URL by hand — `redirectUrl(state)`
   * with no verifier — silently takes the no-PKCE branch, which is the flow the driver
   * documents as protected.
   */
  async redirect(http: HttpContext): Promise<void> {
    const provider = http.params["provider"];
    if (!provider || !this._manager.drivers().includes(provider)) {
      http.response = Response.json({ message: "Unknown provider." }, { status: 404 });
      return;
    }

    this._manager.driver(provider).redirect();
  }

  // ── Step 2: Handle callback (GET + POST) ─────────────────────────────────────

  /**
   * Handle the provider's callback.
   *
   * Delegates to the driver's stateful `user()` — no argument. Passing an explicit code
   * takes the *stateless* branch, which skips both the constant-time `state` check and the
   * PKCE verifier replay. The driver also owns code/state extraction, including Apple's
   * `form_post` body (`AppleDriver._extractCodeAndState`).
   */
  async callback(http: HttpContext): Promise<void> {
    const provider = http.params["provider"];
    if (!provider || !this._manager.drivers().includes(provider)) {
      http.response = Response.json({ message: "Unknown provider." }, { status: 404 });
      return;
    }

    let socialUser;
    try {
      socialUser = await this._manager.driver(provider).user();
    } catch (error) {
      const reason =
        error instanceof OAuthStateMismatchError
          ? "invalid_state"
          : error instanceof OAuthMissingCodeError
            ? "missing_code"
            : "provider_error";
      http.redirect(`${this._errorRedirect}?error=${reason}`);
      return;
    }

    // Delegate find-or-create + session login to the app
    const result = await this._handleCallback({ provider, socialUser, ctx: http });

    if (result?.redirect) {
      http.redirect(result.redirect);
    }
    // If the callback set http.response directly (JSON API), leave it as-is.
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

import type { SocialUser } from "./types.ts";

export interface SocialCallbackPayload {
  /** Which provider triggered the callback ('github', 'google', 'apple', …). */
  provider: string;
  /** Normalised user profile from the provider. */
  socialUser: SocialUser;
  /** The active HTTP context — use ctx.session, ctx.redirect, etc. */
  ctx: HttpContext;
}

export interface SocialCallbackResult {
  /** URL to redirect to after the callback.  Omit if you set ctx.response directly. */
  redirect?: string;
}

export type SocialCallbackFn = (
  payload: SocialCallbackPayload,
) => Promise<SocialCallbackResult | void> | SocialCallbackResult | void;
