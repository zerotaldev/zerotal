import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via Microsoft Identity (Azure AD `common` tenant). Reads the
 * profile from Microsoft Graph `/me`; email falls back to `userPrincipalName` when
 * `mail` is absent.
 *
 * @category Providers
 */
export class MicrosoftDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
  }
  protected tokenUrl() {
    return "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  }
  protected userUrl() {
    return "https://graph.microsoft.com/v1.0/me";
  }

  protected defaultScopes() {
    return ["openid", "profile", "email", "User.Read"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["id"]),
      name: String(raw["displayName"] ?? ""),
      email:
        typeof raw["mail"] === "string"
          ? raw["mail"]
          : typeof raw["userPrincipalName"] === "string"
            ? raw["userPrincipalName"]
            : null,
      // Graph's /me exposes no verification claim, and `userPrincipalName` is whatever the
      // tenant admin assigned — so nothing here amounts to a verified-ownership assertion.
      emailVerified: false,
      avatar: null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
