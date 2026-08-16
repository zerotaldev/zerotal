/**
 * Social config - maps driver names to their OAuth2 credentials.
 *
 * @example
 * // config/social.ts
 * import { SocialConfig } from '@zerotal/auth';
 *
 * export default SocialConfig({
 *   github: {
 *     clientId:     Bun.env.GITHUB_CLIENT_ID!,
 *     clientSecret: Bun.env.GITHUB_CLIENT_SECRET!,
 *     redirectUrl:  Bun.env.GITHUB_REDIRECT_URL!,
 *   },
 *   google: {
 *     clientId:     Bun.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: Bun.env.GOOGLE_CLIENT_SECRET!,
 *     redirectUrl:  Bun.env.GOOGLE_REDIRECT_URL!,
 *   },
 *   apple: {
 *     clientId:   'com.myapp.service',
 *     teamId:     Bun.env.APPLE_TEAM_ID!,
 *     keyId:      Bun.env.APPLE_KEY_ID!,
 *     privateKey: Bun.env.APPLE_PRIVATE_KEY!,   // full PEM string
 *     redirectUrl: Bun.env.APPLE_REDIRECT_URL!,
 *   },
 * });
 */

import { deepMerge } from "@zerotal/core";
import type { DeepPartial } from "@zerotal/core";
import type { ConfigValidator, ConfigIssue } from "@zerotal/core/config";
import type { OAuth2Config, AppleOAuth2Config } from "./types.ts";

/**
 * Shape of `config/social.ts`: maps each provider name to its {@link OAuth2Config}
 * credentials. The built-in keys (`github`, `google`, `apple`, …) are optional and
 * type-checked; the open index signature lets you add custom providers. On boot,
 * {@link SocialProvider} registers a driver for every key with a matching built-in.
 */
export type SocialConfigShape = {
  github?: OAuth2Config & Record<string, unknown>;
  google?: OAuth2Config & Record<string, unknown>;
  apple?: AppleOAuth2Config & Record<string, unknown>;
  discord?: (OAuth2Config & Record<string, unknown>) | undefined;
  microsoft?: (OAuth2Config & Record<string, unknown>) | undefined;
  facebook?: (OAuth2Config & Record<string, unknown>) | undefined;
  twitter?: (OAuth2Config & Record<string, unknown>) | undefined;
  linkedin?: (OAuth2Config & Record<string, unknown>) | undefined;
  gitlab?: (OAuth2Config & Record<string, unknown>) | undefined;
  [driver: string]: (OAuth2Config & Record<string, unknown>) | undefined;
};

// No framework-level defaults - every driver is app-supplied credentials. deepMerge
// keeps this factory on the one canonical merge and returns a fresh, isolated copy.
const defaults: SocialConfigShape = {};

// `DeepPartial` rather than `Partial`, because that is what the merge accepts:
// every driver block is `OAuth2Config & Record<string, unknown>`, so a shallow
// `Partial` demanded a complete driver entry to override one field of it.
export function SocialConfig(config: DeepPartial<SocialConfigShape> = {}): SocialConfigShape {
  return deepMerge(defaults, config);
}

/**
 * Validate the `social` config namespace at boot. Credentials usually arrive as
 * `Bun.env.X!` — the non-null assertion satisfies the compiler while the
 * variable may still be unset at runtime, which otherwise surfaces as a broken
 * redirect in front of a user. A configured provider with an empty credential
 * is an error; an `http://` callback in production is flagged, since the
 * authorization code would transit unencrypted. Registered by
 * {@link SocialProvider} via `app.registerConfigValidator("social", …)`.
 */
export const validateSocialConfig: ConfigValidator = (value, { isProduction }) => {
  const cfg = value as SocialConfigShape | undefined;
  if (!cfg) return [];
  const issues: ConfigIssue[] = [];

  for (const [name, provider] of Object.entries(cfg)) {
    if (!provider) continue;

    if (!provider.clientId) {
      issues.push({
        level: "error",
        message: `social.${name}.clientId is empty — the environment variable it reads is likely unset.`,
      });
    }
    if (!provider.redirectUrl) {
      issues.push({
        level: "error",
        message: `social.${name}.redirectUrl is empty — it must match the callback URL registered with the provider.`,
      });
    } else if (isProduction && provider.redirectUrl.startsWith("http://")) {
      issues.push({
        level: "warning",
        message:
          `social.${name}.redirectUrl uses http:// — the OAuth authorization code transits ` +
          `unencrypted. Use an https:// callback in production.`,
      });
    }

    // Apple may replace the static secret with teamId/keyId/privateKey, from
    // which the driver signs the client-secret JWT itself.
    const apple = provider as { teamId?: string; keyId?: string; privateKey?: string };
    const hasAppleKeys = Boolean(apple.teamId && apple.keyId && apple.privateKey);
    if (!provider.clientSecret && !hasAppleKeys) {
      issues.push({
        level: "error",
        message:
          name === "apple"
            ? `social.apple needs either clientSecret (a pre-signed JWT) or all three of teamId/keyId/privateKey.`
            : `social.${name}.clientSecret is empty — the environment variable it reads is likely unset.`,
      });
    }
  }

  return issues;
};

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    social: SocialConfigShape;
  }
}
