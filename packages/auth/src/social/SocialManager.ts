/**
 * SocialManager — registry of OAuth2 drivers.
 *
 * Register a driver for each social provider in a ServiceProvider, then call
 * `Social.driver('github')` anywhere in the app.
 *
 * @example
 * // In SocialProvider.ts or your AppProvider.ts:
 * Social.register('github', new GitHubDriver({
 *   clientId:     Bun.env.GITHUB_CLIENT_ID!,
 *   clientSecret: Bun.env.GITHUB_CLIENT_SECRET!,
 *   redirectUrl:  'https://myapp.com/auth/github/callback',
 * }));
 *
 * // In a controller:
 * const redirectUrl = Social.driver('github').redirectUrl(state);
 * const user        = await Social.driver('github').user(code);
 */

import type { OAuth2Driver } from "./drivers/OAuth2Driver.ts";
import type { SocialUser } from "./types.ts";
import { UnknownSocialDriverError } from "./errors.ts";
import { FakeSocialDriver, fakeSocialUser } from "./testing.ts";

/**
 * Registry of social-login {@link OAuth2Driver}s, bound in the container as
 * `"social"` and reached everywhere through the {@link Social} facade.
 *
 * {@link SocialProvider} auto-registers a driver for each provider declared in
 * `config/social.ts`; register custom providers manually with {@link register}.
 * In tests, {@link fake} swaps any provider for a network-free fake.
 *
 * @example
 * ```ts
 * // Resolve a driver and start the flow (see OAuth2Driver.redirect / .user):
 * Social.driver("github").redirect();
 * const socialUser = await Social.driver("github").user();
 * ```
 */
export class SocialManager {
  private readonly _drivers = new Map<string, OAuth2Driver>();

  /** Register a driver under a name (e.g. 'github', 'google'). */
  register(name: string, driver: OAuth2Driver): this {
    this._drivers.set(name, driver);
    return this;
  }

  /**
   * Retrieve a registered driver by name.
   *
   * @param name - The provider key it was registered under (e.g. `'github'`).
   * @returns The driver instance.
   * @throws {UnknownSocialDriverError} If no driver is registered under `name`.
   */
  driver(name: string): OAuth2Driver {
    const d = this._drivers.get(name);
    if (!d) throw new UnknownSocialDriverError(name);
    return d;
  }

  /** List all registered driver names. */
  drivers(): string[] {
    return [...this._drivers.keys()];
  }

  /**
   * Replace a provider with a {@link FakeSocialDriver} for tests. `redirect()`
   * still works; `user()` returns `user` without touching the network. Returns
   * the fake user for convenience.
   *
   * @example
   * Social.fake("github", fakeSocialUser({ id: "github-123" }));
   */
  fake(name: string, user: SocialUser = fakeSocialUser()): SocialUser {
    this.register(name, new FakeSocialDriver(user));
    return user;
  }
}
