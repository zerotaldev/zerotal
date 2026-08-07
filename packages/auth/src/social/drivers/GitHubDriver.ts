import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Authenticates users via GitHub OAuth. Reads the profile from `api.github.com/user`,
 * and — because GitHub hides emails by default — falls back to `/user/emails` to
 * recover the primary verified address.
 *
 * @category Providers
 */
export class GitHubDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://github.com/login/oauth/authorize";
  }
  protected tokenUrl() {
    return "https://github.com/login/oauth/access_token";
  }
  protected userUrl() {
    return "https://api.github.com/user";
  }

  protected defaultScopes() {
    return ["read:user", "user:email"];
  }

  /** GitHub does not accept response_type=code and returns 404 if present. */
  protected override includeResponseType(): boolean {
    return false;
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    return {
      id: String(raw["id"]),
      name: String(raw["name"] ?? raw["login"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      // /user returns the public profile email, which GitHub does not require to be
      // verified. afterNormalise() upgrades this when it falls back to /user/emails, which
      // does carry a verified flag.
      emailVerified: false,
      avatar: typeof raw["avatar_url"] === "string" ? raw["avatar_url"] : null,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }

  /**
   * If the user has hidden their email, GitHub returns null on the /user
   * endpoint.  This hook automatically fetches the primary verified address
   * from /user/emails — no extra code needed in your controller.
   */
  protected override async afterNormalise(user: SocialUser, token: string): Promise<SocialUser> {
    if (user.email === null) {
      user.email = await this._fetchPrimaryEmail(token);
      // /user/emails only ever yields an address GitHub has confirmed the user controls.
      user.emailVerified = user.email !== null;
    }
    return user;
  }

  private async _fetchPrimaryEmail(token: string): Promise<string | null> {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as GitHubEmail[];
    return emails.find((e) => e.primary && e.verified)?.email ?? null;
  }
}
