import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via LinkedIn (OpenID Connect). Reads the profile from the
 * `/v2/userinfo` endpoint, so the user id comes from the standard OIDC `sub` claim.
 *
 * @category Providers
 */
export class LinkedInDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://www.linkedin.com/oauth/v2/authorization";
  }
  protected tokenUrl() {
    return "https://www.linkedin.com/oauth/v2/accessToken";
  }
  protected userUrl() {
    return "https://api.linkedin.com/v2/userinfo";
  }

  protected defaultScopes() {
    return ["openid", "profile", "email"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["sub"]),
      name: String(raw["name"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      emailVerified: false,
      avatar: typeof raw["picture"] === "string" ? raw["picture"] : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
