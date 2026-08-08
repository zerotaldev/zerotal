/**
 * The `@zerotal/core/config` subpath — the runtime configuration system.
 *
 * Config lives in a set of `config/*.ts` files, each default-exporting one
 * namespace object (`config/app.ts` → the `app` namespace). {@link configLoader}
 * discovers and loads them synchronously into a {@link ConfigLoader}, which the
 * application hands to a {@link ConfigManager} — the store that serves
 * dot-path reads/writes behind the `Config` facade and the `config()` helper.
 * {@link AppConfig} builds the framework's own `app` namespace with defaults,
 * and the {@link ConfigRegistry} interface makes dot-path access type-checked.
 *
 * The everyday `config()` helper lives on the kernel barrel (`@zerotal/core`);
 * the symbols here are the lower-level classes and types used when defining or
 * wiring configuration.
 *
 * @example
 * ```ts
 * import { configLoader } from "@zerotal/core/config";
 * import { Application } from "@zerotal/core";
 *
 * // In the entry script — load and validate config, then boot the app.
 * const config = configLoader("./config").validate();
 * const app = Application.create({ config });
 * ```
 *
 * @packageDocumentation
 */
export { ConfigManager } from "./ConfigManager.ts";
export { configLoader, ConfigLoader } from "./ConfigLoader.ts";
export type { ConfigMap } from "./ConfigLoader.ts";
export { AppConfig } from "./AppConfig.ts";
export type {
  AppConfigShape,
  AppTlsConfig,
  ConventionsConfig,
  AppAssetsConfig,
  AssetLoaderKind,
} from "./AppConfig.ts";
export type { ConfigRegistry, ConfigPath, ConfigValue } from "./registry.ts";
export { ConfigValidationError } from "./validation.ts";
export type {
  ConfigIssue,
  ConfigIssueLevel,
  ConfigValidator,
  ConfigValidationContext,
  RegisteredConfigValidator,
} from "./validation.ts";
