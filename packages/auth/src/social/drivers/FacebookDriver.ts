import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via Facebook Login (Graph API v18.0). Requests
 * `id,name,email,picture` from `/me`; the avatar comes from the nested
 * `picture.data.url`.
 *
 * @category Providers
 */
export class FacebookDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://www.facebook.com/v18.0/dialog/oauth";
  }
  protected tokenUrl() {
    return "https://graph.facebook.com/v18.0/oauth/access_token";
  }
  protected userUrl() {
    return "https://graph.facebook.com/v18.0/me?fields=id,name,email,picture.type(large)";
  }

  protected defaultScopes() {
    return ["email", "public_profile"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    const picture = raw["picture"] as { data?: { url?: unknown } } | undefined;
    const avatarUrl = picture?.data?.url;
    return {
      id: String(raw["id"]),
      name: String(raw["name"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      emailVerified: false,
      avatar: typeof avatarUrl === "string" ? avatarUrl : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
