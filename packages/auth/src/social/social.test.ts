import { describe, it, expect } from "bun:test";
import { SocialManager } from "./SocialManager.ts";
import { OAuth2Driver } from "./drivers/OAuth2Driver.ts";
import { SocialConfig } from "./config.ts";
import { FakeSocialDriver, fakeSocialUser } from "./testing.ts";
import type { OAuth2Config, SocialUser } from "./types.ts";

class TestDriver extends OAuth2Driver {
  protected authUrl() {
    return "https://provider.test/authorize";
  }
  protected tokenUrl() {
    return "https://provider.test/token";
  }
  protected userUrl() {
    return "https://provider.test/me";
  }
  protected normalise(): SocialUser {
    return { id: "1" } as SocialUser;
  }
  protected defaultScopes() {
    return ["email", "profile"];
  }
}
class CommaNoTypeDriver extends TestDriver {
  protected override scopeSeparator() {
    return ",";
  }
  protected override includeResponseType() {
    return false;
  }
  protected override extraAuthParams() {
    return { prompt: "consent" };
  }
}
const conf = (over: Partial<OAuth2Config> = {}): OAuth2Config => ({
  clientId: "cid",
  clientSecret: "secret",
  redirectUrl: "https://app.test/cb",
  ...over,
});

describe("SocialManager", () => {
  it("registers and resolves drivers", () => {
    const m = new SocialManager();
    const d = new TestDriver(conf());
    m.register("github", d);
    expect(m.driver("github")).toBe(d);
    expect(m.drivers()).toEqual(["github"]);
  });
  it("throws for an unregistered driver", () => {
    expect(() => new SocialManager().driver("nope")).toThrow(/not registered/);
  });
});

describe("OAuth2Driver.redirectUrl", () => {
  it("includes client_id, redirect_uri, scope, state and response_type", () => {
    const url = new URL(new TestDriver(conf()).redirectUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://provider.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(url.searchParams.get("scope")).toBe("email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
  it("honours scope separator, omits response_type, and appends extra params", () => {
    const url = new URL(new CommaNoTypeDriver(conf()).redirectUrl("s"));
    expect(url.searchParams.get("scope")).toBe("email,profile");
    expect(url.searchParams.get("response_type")).toBeNull();
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
  it("uses configured scopes over defaults", () => {
    const url = new URL(new TestDriver(conf({ scopes: ["repo"] })).redirectUrl("s"));
    expect(url.searchParams.get("scope")).toBe("repo");
  });
  it("stateless() returns a distinct copy, leaving the original intact", () => {
    const d = new TestDriver(conf());
    const s = d.stateless();
    expect(s).not.toBe(d);
    expect(s).toBeInstanceOf(TestDriver);
  });
});

describe("OAuth2Driver PKCE (RFC 7636)", () => {
  const s256 = (verifier: string) =>
    Buffer.from(new Bun.CryptoHasher("sha256").update(verifier).digest()).toString("base64url");

  it("redirectUrl() with a verifier includes an S256 code_challenge", () => {
    const verifier = "test-verifier-0123456789abcdefghijklmnopqrstuv";
    const url = new URL(new TestDriver(conf()).redirectUrl("s", verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(s256(verifier));
    // The verifier itself must never appear on the authorize URL.
    expect(url.toString()).not.toContain(verifier);
  });

  it("redirectUrl() without a verifier omits PKCE params (backwards compatible)", () => {
    const url = new URL(new TestDriver(conf()).redirectUrl("s"));
    expect(url.searchParams.get("code_challenge")).toBeNull();
    expect(url.searchParams.get("code_challenge_method")).toBeNull();
  });

  it("redirect() stores the verifier in the session and sends only its challenge", async () => {
    const { RequestContext } = await import("@zerotal/core");
    const store = new Map<string, unknown>();
    const session = {
      set: (k: string, v: unknown) => void store.set(k, v),
      get: (k: string) => store.get(k),
      forget: (k: string) => void store.delete(k),
    };
    let redirected = "";
    const ctx = {
      request: new Request("http://app.test/auth/redirect"),
      session,
      redirect: (u: string) => {
        redirected = u;
      },
    };
    await RequestContext.run(ctx as never, async () => {
      new TestDriver(conf()).redirect();
    });

    const verifier = store.get("oauth_pkce_verifier") as string;
    expect(typeof verifier).toBe("string");
    expect(verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636 §4.1 minimum

    const url = new URL(redirected);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(s256(verifier));
    expect(url.searchParams.get("state")).toBe(store.get("oauth_state") as string);
  });
});

describe("OAuth2Driver fluent builders (Socialite parity)", () => {
  it("scopes() merges with defaults and returns a non-mutating copy", () => {
    const d = new TestDriver(conf());
    const scoped = d.scopes(["repo"]);
    expect(scoped).not.toBe(d);
    // merged: defaults (email, profile) + repo
    expect(new URL(scoped.redirectUrl("s")).searchParams.get("scope")).toBe("email profile repo");
    // original is untouched
    expect(new URL(d.redirectUrl("s")).searchParams.get("scope")).toBe("email profile");
  });

  it("scopes() de-duplicates", () => {
    const url = new URL(new TestDriver(conf()).scopes(["email", "repo"]).redirectUrl("s"));
    expect(url.searchParams.get("scope")).toBe("email profile repo");
  });

  it("setScopes() replaces all scopes", () => {
    const url = new URL(new TestDriver(conf()).setScopes(["only:this"]).redirectUrl("s"));
    expect(url.searchParams.get("scope")).toBe("only:this");
  });

  it("with() appends optional params and overrides extraAuthParams()", () => {
    const url = new URL(
      new CommaNoTypeDriver(conf())
        .with({ prompt: "select_account", access_type: "offline" })
        .redirectUrl("s"),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    // with() wins over the driver's extraAuthParams() prompt: 'consent'
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("with() returns a non-mutating copy", () => {
    const d = new TestDriver(conf());
    const w = d.with({ access_type: "offline" });
    expect(w).not.toBe(d);
    expect(new URL(d.redirectUrl("s")).searchParams.get("access_type")).toBeNull();
  });
});

describe("FakeSocialDriver (Socialite fake())", () => {
  it("fakeSocialUser() fills complete defaults and honours overrides", () => {
    const u = fakeSocialUser({ id: "github-123", email: "a@b.com" });
    expect(u.id).toBe("github-123");
    expect(u.email).toBe("a@b.com");
    expect(u.token).toBe("fake-access-token");
    expect(u.refreshToken).toBe("fake-refresh-token");
    expect(u.expiresIn).toBe(3600);
  });

  it("user() / userFromToken() return the canned profile without network", async () => {
    const user = fakeSocialUser({ id: "x-1", name: "Jane" });
    const d = new FakeSocialDriver(user);
    expect(await d.user()).toEqual(user);
    expect(await d.userFromToken("tok")).toEqual(user);
  });

  it("SocialManager.fake() registers a fake driver and returns the user", async () => {
    const m = new SocialManager();
    const returned = m.fake("github", fakeSocialUser({ id: "github-123" }));
    expect(returned.id).toBe("github-123");
    expect(m.driver("github")).toBeInstanceOf(FakeSocialDriver);
    expect((await m.driver("github").user()).id).toBe("github-123");
  });

  it("fake driver still builds a redirect URL (offline)", () => {
    const m = new SocialManager();
    m.fake("github");
    const url = new URL(m.driver("github").redirectUrl("state-1"));
    expect(url.origin).toBe("https://provider.fake");
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});

describe("SocialConfig", () => {
  it("returns the config", () => {
    const c = SocialConfig({ github: { clientId: "a", clientSecret: "b", redirectUrl: "c" } });
    expect(c.github?.clientId).toBe("a");
  });
});
