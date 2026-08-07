// Social authentication (OAuth2) — part of @zerotal/auth.
// Re-exported from the auth package root; consumers import these from "@zerotal/auth".

// Side-effect import: augments @zerotal/core RouterMacros so Router.social() is typed.
import "./augment.ts";

// Core
export { SocialManager } from "./SocialManager.ts";
export { SocialProvider } from "../provider/SocialProvider.ts";
export { Social } from "./facades/Social.ts";

// Drivers
export { OAuth2Driver } from "./drivers/OAuth2Driver.ts";
export type { TokenBundle } from "./drivers/OAuth2Driver.ts";
export { GitHubDriver } from "./drivers/GitHubDriver.ts";
export { GoogleDriver } from "./drivers/GoogleDriver.ts";
export { AppleDriver } from "./drivers/AppleDriver.ts";
export { DiscordDriver } from "./drivers/DiscordDriver.ts";
export { MicrosoftDriver } from "./drivers/MicrosoftDriver.ts";
export { FacebookDriver } from "./drivers/FacebookDriver.ts";
export { TwitterDriver } from "./drivers/TwitterDriver.ts";
export { LinkedInDriver } from "./drivers/LinkedInDriver.ts";
export { GitLabDriver } from "./drivers/GitLabDriver.ts";

// Testing helpers
export { FakeSocialDriver, fakeSocialUser } from "./testing.ts";

// Config
export { SocialConfig } from "./config.ts";
export type { SocialConfigShape } from "./config.ts";

// Types
export type {
  SocialUser,
  OAuth2Config,
  AppleOAuth2Config,
  SocialHttpContext,
  SocialSession,
} from "./types.ts";

// Typed error vocabulary
export * from "./errors.ts";
