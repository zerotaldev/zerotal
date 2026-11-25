import { env } from "zerotal";
import { SocialConfig } from "zerotal/auth";

/**
 * Sign in with GitHub or Google — each one on only once its keys are in .env.
 *
 * A provider listed here with an empty client id refuses to boot in production, which
 * is right for a provider you meant to turn on. Listing them conditionally keeps that
 * check for the ones that are on, and leaves the rest out entirely: the sign-in page
 * offers a button for exactly the providers registered here.
 *
 * Register an OAuth app with the provider and set its callback URL to
 * `${APP_URL}/auth/<provider>/callback`.
 */
const appUrl = env("APP_URL", "http://localhost:3000");

export default SocialConfig({
  ...(env("GITHUB_CLIENT_ID", "")
    ? {
        github: {
          clientId: env("GITHUB_CLIENT_ID", ""),
          clientSecret: env("GITHUB_CLIENT_SECRET", ""),
          redirectUrl: `${appUrl}/auth/github/callback`,
        },
      }
    : {}),
  ...(env("GOOGLE_CLIENT_ID", "")
    ? {
        google: {
          clientId: env("GOOGLE_CLIENT_ID", ""),
          clientSecret: env("GOOGLE_CLIENT_SECRET", ""),
          redirectUrl: `${appUrl}/auth/google/callback`,
        },
      }
    : {}),
});
