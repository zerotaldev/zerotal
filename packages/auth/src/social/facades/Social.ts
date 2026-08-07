/**
 * Static entry point for social OAuth login. Resolves the {@link SocialManager}
 * bound in the container as `"social"`, so `Social.driver(name)` gives you a
 * configured {@link OAuth2Driver} anywhere in the app.
 *
 * Available once {@link SocialProvider} is registered and `config/social.ts` is in
 * place. See {@link OAuth2Driver} for the full redirect/callback flow.
 *
 * @remarks
 * Facade methods mirror {@link SocialManager}: `driver()`, `register()`,
 * `drivers()`, and `fake()` (tests).
 *
 * @example
 * ```ts
 * import { Social } from "@zerotal/auth";
 *
 * // Redirect to the provider:
 * Social.driver("github").redirect();
 *
 * // Handle the callback:
 * const socialUser = await Social.driver("github").user();
 * ```
 */
import { createFacade } from "@zerotal/core";
import type { SocialManager } from "../SocialManager.ts";

// Extend the core container bindings so createFacade knows the type.
declare module "@zerotal/core" {
  interface ContainerBindings {
    social: SocialManager;
  }
}

export const Social = createFacade("social");
