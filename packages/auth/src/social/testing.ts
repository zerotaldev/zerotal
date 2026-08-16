/**
 * Test helpers for social authentication.
 *
 * `FakeSocialDriver` short-circuits the network: `redirect()` still issues a real
 * redirect to a fake authorize URL (and persists CSRF state, so stateful flows
 * work), while `user()` / `userFromToken()` return a canned profile instead of
 * exchanging a code with the provider.
 *
 * @example
 * import { Social, fakeSocialUser } from "@zerotal/auth";
 *
 * Social.fake("github", fakeSocialUser({ id: "github-123", email: "a@b.com" }));
 *
 * const res = await app.get("/auth/github/callback");
 * res.assertRedirect("/dashboard");
 */
import { OAuth2Driver } from "./drivers/OAuth2Driver.ts";
import type { SocialUser, OAuth2Config } from "./types.ts";

/**
 * Build a complete {@link SocialUser} with sensible fake defaults. Override any
 * field via `overrides`.
 */
export function fakeSocialUser(overrides: Partial<SocialUser> = {}): SocialUser {
  return {
    id: "fake-id",
    name: "Fake User",
    email: "fake@example.com",
    // Default to unverified: a test that relies on find-or-create-by-email should have to
    // say so, since that is the branch with the account-takeover risk.
    emailVerified: false,
    avatar: null,
    token: "fake-access-token",
    refreshToken: "fake-refresh-token",
    expiresIn: 3600,
    raw: {},
    ...overrides,
  };
}

const FAKE_CONFIG: OAuth2Config = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  redirectUrl: "https://example.test/auth/callback",
};

/**
 * A drop-in OAuth2 driver for tests. Register it via {@link SocialManager.fake}
 * (or `Social.fake(...)`) rather than constructing it directly.
 *
 * `redirect()` is inherited unchanged — it builds the authorize URL and stores
 * the CSRF state in the session, exactly like a real driver, so redirect-route
 * tests pass. `user()` / `userFromToken()` skip code exchange and state checks
 * and return the canned profile.
 */
export class FakeSocialDriver extends OAuth2Driver {
  private readonly _user: SocialUser;

  constructor(user: SocialUser = fakeSocialUser()) {
    super(FAKE_CONFIG);
    this._user = user;
  }

  protected authUrl(): string {
    return "https://provider.fake/authorize";
  }
  protected tokenUrl(): string {
    return "https://provider.fake/token";
  }
  protected userUrl(): string {
    return "https://provider.fake/user";
  }
  protected defaultScopes(): string[] {
    return [];
  }
  protected normalise(): SocialUser {
    return this._user;
  }

  /** Return the canned profile (a copy) without hitting the provider. */
  override async user(): Promise<SocialUser> {
    return { ...this._user };
  }

  /**
   * Return the canned profile (a copy) without hitting the provider.
   *
   * The parameter is declared even though it is unused: a fake has to be
   * callable everywhere the real driver is, and an override that drops the
   * argument makes `fake.userFromToken(accessToken)` a compile error while the
   * line it replaces in production code is fine.
   */
  override async userFromToken(_token?: string): Promise<SocialUser> {
    return { ...this._user };
  }
}
