import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via Google (OpenID Connect). The profile id is the OIDC
 * `sub` claim. Defaults to `access_type=online`; pass
 * `.with({ access_type: 'offline', prompt: 'consent' })` to receive a refresh token.
 *
 * @category Providers
 */
export class GoogleDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }
  protected tokenUrl() {
    return "https://oauth2.googleapis.com/token";
  }
  protected userUrl() {
    return "https://www.googleapis.com/oauth2/v3/userinfo";
  }

  protected defaultScopes() {
    return ["openid", "profile", "email"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["sub"]),
      name: String(raw["name"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      // Google's OIDC `email_verified` claim. Workspace admins can create any local part on
      // a domain they control, so an unverified address must never be matched onto an
      // existing account by address alone.
      emailVerified: raw["email_verified"] === true || raw["email_verified"] === "true",
      avatar: typeof raw["picture"] === "string" ? raw["picture"] : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }

  protected override extraAuthParams(): Record<string, string> {
    return { access_type: "online" };
  }
}
