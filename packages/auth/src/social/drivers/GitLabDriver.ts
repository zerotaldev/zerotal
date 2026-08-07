import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via GitLab (gitlab.com) OAuth. Reads the profile from the
 * `/api/v4/user` endpoint using the `read_user` scope.
 *
 * @category Providers
 */
export class GitLabDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://gitlab.com/oauth/authorize";
  }
  protected tokenUrl() {
    return "https://gitlab.com/oauth/token";
  }
  protected userUrl() {
    return "https://gitlab.com/api/v4/user";
  }

  protected defaultScopes() {
    return ["read_user"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["id"]),
      name: String(raw["name"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      emailVerified: false,
      avatar: typeof raw["avatar_url"] === "string" ? raw["avatar_url"] : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
