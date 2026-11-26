import { deepMerge } from "@zerotal/core";

export interface SettingsConfigShape {
  /** The table overrides are stored in. Default: `"zerotal_settings"`. */
  table: string;
  /**
   * Record every change through `@zerotal/audit` when `AuditProvider` is
   * registered: who changed which setting, at which level, from what to what.
   * Default: `true`. Without the audit provider there is nothing to record to,
   * and nothing is.
   */
  audit: boolean;
}

const defaults: SettingsConfigShape = {
  table: "zerotal_settings",
  audit: true,
};

/**
 * Create a typed settings configuration object with defaults.
 *
 * @example
 * // config/settings.ts
 * import { SettingsConfig } from "@zerotal/settings";
 * export default SettingsConfig({ audit: true });
 */
export function SettingsConfig(options: Partial<SettingsConfigShape> = {}): SettingsConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    settings: SettingsConfigShape;
  }
}
