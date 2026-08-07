/**
 * SocialProvider — binds a SocialManager singleton, registers the Router.social()
 * macro, and auto-registers OAuth2 drivers from `config/social.ts`.
 *
 * Usage:
 *   1. Create `config/social.ts` using `SocialConfig()`.
 *   2. Add `SocialProvider` to your bootstrap providers.
 *   3. Write your own redirect + callback controller.
 *   4. Call `Router.social('/auth', SocialController)` in your routes file.
 *
 * @example
 * // bootstrap/app.ts
 * import { SocialProvider } from '@zerotal/auth';
 *
 * Application.create()
 *   .register([SocialProvider, /* other providers *\/])
 *
 * // routes/auth.ts
 * import { Router } from "@zerotal/core";
 * import { SocialController } from '../app/controllers/SocialController.ts';
 *
 * Router.social('/auth', SocialController);
 */

import "../social/augment.ts"; // activate RouterMacros type augmentation

import { ServiceProvider, Router } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { SocialManager } from "../social/SocialManager.ts";
import { GitHubDriver } from "../social/drivers/GitHubDriver.ts";
import { GoogleDriver } from "../social/drivers/GoogleDriver.ts";
import { AppleDriver } from "../social/drivers/AppleDriver.ts";
import { DiscordDriver } from "../social/drivers/DiscordDriver.ts";
import { MicrosoftDriver } from "../social/drivers/MicrosoftDriver.ts";
import { FacebookDriver } from "../social/drivers/FacebookDriver.ts";
import { TwitterDriver } from "../social/drivers/TwitterDriver.ts";
import { LinkedInDriver } from "../social/drivers/LinkedInDriver.ts";
import { GitLabDriver } from "../social/drivers/GitLabDriver.ts";
import type { OAuth2Driver } from "../social/drivers/OAuth2Driver.ts";
import type { OAuth2Config } from "../social/types.ts";
import type { SocialConfigShape } from "../social/config.ts";
import { validateSocialConfig } from "../social/config.ts";

// ── Built-in driver map ───────────────────────────────────────────────────────

type DriverCtor = new (config: OAuth2Config & Record<string, unknown>) => OAuth2Driver;

const BUILT_IN: Record<string, DriverCtor> = {
  github: GitHubDriver as unknown as DriverCtor,
  google: GoogleDriver as unknown as DriverCtor,
  apple: AppleDriver as unknown as DriverCtor,
  discord: DiscordDriver as unknown as DriverCtor,
  microsoft: MicrosoftDriver as unknown as DriverCtor,
  facebook: FacebookDriver as unknown as DriverCtor,
  twitter: TwitterDriver as unknown as DriverCtor,
  linkedin: LinkedInDriver as unknown as DriverCtor,
  gitlab: GitLabDriver as unknown as DriverCtor,
};

// ── Provider ──────────────────────────────────────────────────────────────────

export class SocialProvider extends ServiceProvider {
  static override provides = ["social"] as const;
  static override environments: AppEnvironment[] = ["web", "test"];

  override onRegister(): void {
    // Refuse a production boot when a configured provider is missing credentials
    // (an unset env var behind a `!`). Runs in the boot-time config pass.
    this.app.registerConfigValidator?.("social", validateSocialConfig);

    // Bind the SocialManager singleton.
    this.app.container.singleton("social", () => new SocialManager());

    // Register Router.social() — available in route files before the app boots.
    Router.macro("social", (prefix: string, controller: new (...args: unknown[]) => unknown) => {
      Router.get(`${prefix}/:provider`, controller, "redirect");
      Router.get(`${prefix}/:provider/callback`, controller, "callback");
      Router.post(`${prefix}/:provider/callback`, controller, "callback");
    });
  }

  override async onBooted(): Promise<void> {
    const manager = (await this.app.container.make("social")) as SocialManager;

    // Read social config from the app's config service (config/social.ts).
    let socialCfg: SocialConfigShape | undefined;
    try {
      const config = this.app.container.makeSync<{ get<T>(key: string): T }>("config");
      socialCfg = config.get<SocialConfigShape>("social");
    } catch {
      // Config service unavailable — drivers can be registered manually via
      // Social.register() inside your own ServiceProvider.
      return;
    }

    if (!socialCfg) return;

    for (const [name, driverConfig] of Object.entries(socialCfg)) {
      if (!driverConfig) continue;
      const Ctor = BUILT_IN[name];
      if (Ctor) {
        manager.register(name, new Ctor(driverConfig as OAuth2Config & Record<string, unknown>));
      }
      // Unknown keys are silently skipped.
      // Register custom drivers via Social.register() after boot.
    }
  }
}
