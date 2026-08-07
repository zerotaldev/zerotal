import { describe, it, expect } from "bun:test";
import { OAuth2Driver } from "./OAuth2Driver.ts";
import { DiscordDriver } from "./DiscordDriver.ts";
import { MicrosoftDriver } from "./MicrosoftDriver.ts";
import { FacebookDriver } from "./FacebookDriver.ts";
import { TwitterDriver } from "./TwitterDriver.ts";
import { LinkedInDriver } from "./LinkedInDriver.ts";
import { GitLabDriver } from "./GitLabDriver.ts";
import type { OAuth2Config, SocialUser } from "../types.ts";

const conf: OAuth2Config = {
  clientId: "id",
  clientSecret: "secret",
  redirectUrl: "https://app.test/cb",
};

/** Reach into the protected normalise()/defaultScopes() for assertions. */
type Exposed = OAuth2Driver & {
  normalise(raw: Record<string, unknown>, token: string): SocialUser;
  defaultScopes(): string[];
};
const expose = (d: OAuth2Driver): Exposed => d as Exposed;

interface Case {
  name: string;
  driver: OAuth2Driver;
  host: string;
  raw: Record<string, unknown>;
  expectId: string;
}

const cases: Case[] = [
  {
    name: "DiscordDriver",
    driver: new DiscordDriver(conf),
    host: "discord.com",
    raw: { id: "42", username: "bob", email: "bob@discord.test", avatar: "abc" },
    expectId: "42",
  },
  {
    name: "MicrosoftDriver",
    driver: new MicrosoftDriver(conf),
    host: "login.microsoftonline.com",
    raw: { id: "ms-1", displayName: "Bob", mail: "bob@ms.test" },
    expectId: "ms-1",
  },
  {
    name: "FacebookDriver",
    driver: new FacebookDriver(conf),
    host: "www.facebook.com",
    raw: {
      id: "fb-1",
      name: "Bob",
      email: "bob@fb.test",
      picture: { data: { url: "https://fb.test/p.png" } },
    },
    expectId: "fb-1",
  },
  {
    name: "TwitterDriver",
    driver: new TwitterDriver(conf),
    host: "twitter.com",
    raw: {
      data: {
        id: "tw-1",
        name: "Bob",
        username: "bob",
        profile_image_url: "https://tw.test/p.png",
      },
    },
    expectId: "tw-1",
  },
  {
    name: "LinkedInDriver",
    driver: new LinkedInDriver(conf),
    host: "www.linkedin.com",
    raw: { sub: "li-1", name: "Bob", email: "bob@li.test", picture: "https://li.test/p.png" },
    expectId: "li-1",
  },
  {
    name: "GitLabDriver",
    driver: new GitLabDriver(conf),
    host: "gitlab.com",
    raw: { id: 7, name: "Bob", email: "bob@gl.test", avatar_url: "https://gl.test/p.png" },
    expectId: "7",
  },
];

describe("social provider drivers", () => {
  for (const c of cases) {
    describe(c.name, () => {
      it("builds a redirect URL with the correct host and params", () => {
        const url = new URL(c.driver.redirectUrl("state-xyz"));
        expect(url.host).toBe(c.host);
        expect(url.searchParams.get("client_id")).toBe("id");
        expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
        expect(url.searchParams.get("scope")).toBe(expose(c.driver).defaultScopes().join(" "));
        expect(url.searchParams.get("state")).toBe("state-xyz");
      });

      it("normalise() returns a SocialUser with null refreshToken/expiresIn", () => {
        const user = expose(c.driver).normalise(c.raw, "tok-123");
        expect(user.id).toBe(c.expectId);
        expect(user.token).toBe("tok-123");
        expect(user.refreshToken).toBeNull();
        expect(user.expiresIn).toBeNull();
        expect(user.raw).toBe(c.raw);
      });
    });
  }

  it("DiscordDriver builds avatar URL from id + avatar hash, null when absent", () => {
    const d = expose(new DiscordDriver(conf));
    expect(d.normalise({ id: "42", avatar: "abc" }, "t").avatar).toBe(
      "https://cdn.discordapp.com/avatars/42/abc.png",
    );
    expect(d.normalise({ id: "42" }, "t").avatar).toBeNull();
  });

  it("FacebookDriver guards nested picture access", () => {
    const d = expose(new FacebookDriver(conf));
    expect(d.normalise({ id: "1", name: "x" }, "t").avatar).toBeNull();
  });

  it("TwitterDriver reads from raw.data and never returns email", () => {
    const d = expose(new TwitterDriver(conf));
    const user = d.normalise({ data: { id: "9", name: "Z", profile_image_url: "u" } }, "t");
    expect(user.id).toBe("9");
    expect(user.avatar).toBe("u");
    expect(user.email).toBeNull();
  });
});
