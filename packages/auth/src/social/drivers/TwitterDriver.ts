import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via Twitter (X) OAuth2. The user-info endpoint wraps the
 * profile under a `data` envelope, so `normalise()` reads from `(raw.data ?? raw)`.
 * X does not return an email address by default, so `email` is always `null`.
 *
 * @category Providers
 */
export class TwitterDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://twitter.com/i/oauth2/authorize";
  }
  protected tokenUrl() {
    return "https://api.twitter.com/2/oauth2/token";
  }
  protected userUrl() {
    return "https://api.twitter.com/2/users/me?user.fields=profile_image_url";
  }

  protected defaultScopes() {
    return ["tweet.read", "users.read"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    const profile = (raw["data"] ?? raw) as Record<string, unknown>;
    return {
      id: String(profile["id"]),
      name: String(profile["name"] ?? profile["username"] ?? ""),
      email: null,
      emailVerified: false,
      avatar:
        typeof profile["profile_image_url"] === "string" ? profile["profile_image_url"] : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
