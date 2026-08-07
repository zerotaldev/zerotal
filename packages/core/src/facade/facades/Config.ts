/**
 * The `Config` facade — static-style access to the application configuration
 * registered under the container's `config` binding.
 */
import { createFacade } from "../Facade.ts";

/**
 * Facade over the `config` binding for reading configuration values.
 *
 * Resolves the live `config` instance from the container on each access, so it
 * is only usable after `Application.boot()` has run.
 *
 * @example
 * ```ts
 * import { Config } from "@zerotal/core/facades";
 *
 * Config.get("app.name");         // read with the app's config value type
 * Config.require("app.key");      // throws ConfigError when unset
 * ```
 */
export const Config = createFacade("config");
