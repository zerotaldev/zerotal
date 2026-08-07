import { OAuth2Driver } from "./OAuth2Driver.ts";
import type { SocialUser } from "../types.ts";

/**
 * Authenticates users via Discord OAuth. Reads the profile from `/users/@me` and
 * builds the avatar URL from the account id + avatar hash off Discord's CDN.
 *
 * @category Providers
 */
export class DiscordDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://discord.com/api/oauth2/authorize";
  }
  protected tokenUrl() {
    return "https://discord.com/api/oauth2/token";
  }
  protected userUrl() {
    return "https://discord.com/api/users/@me";
  }

  protected defaultScopes() {
    return ["identify", "email"];
  }

  protected normalise(raw: Record<string, unknown>, token: string): SocialUser {
    const id = String(raw["id"]);
    const avatar =
      typeof raw["avatar"] === "string"
        ? `https://cdn.discordapp.com/avatars/${id}/${raw["avatar"]}.png`
        : null;
    return {
      id,
      name: String(raw["username"] ?? raw["global_name"] ?? ""),
      email: typeof raw["email"] === "string" ? raw["email"] : null,
      emailVerified: false,
      avatar,
      token,
      refreshToken: null,
      expiresIn: null,
      raw,
    };
  }
}
