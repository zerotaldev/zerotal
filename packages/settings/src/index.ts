// @zerotal/settings — public API

// Declaring settings
export { defineSettings } from "./defineSettings.ts";
export type {
  SettingsGroup,
  SettingDefinitions,
  SettingValue,
  SettingValues,
} from "./defineSettings.ts";
export { setting } from "./setting.ts";
export type {
  SettingDefinition,
  SettingScopeKind,
  SettingType,
  BaseSettingOptions,
  StringSettingOptions,
  NumberSettingOptions,
  BooleanSettingOptions,
  EnumSettingOptions,
  JsonSettingOptions,
} from "./setting.ts";

// Reading and writing
export { SettingsManager } from "./SettingsManager.ts";
export type {
  ResolvedSetting,
  SettingLevel,
  SettingSource,
  SettingWriteOptions,
  SettingHistoryEntry,
  SettingHistoryOptions,
} from "./SettingsManager.ts";
export type { SettingsScope } from "./scope.ts";
export { Settings } from "./facades/Settings.ts";

// Storage
export type { SettingsStore, StoredSetting } from "./stores/SettingsStore.ts";
export { DatabaseStore } from "./stores/DatabaseStore.ts";
export { MemoryStore } from "./stores/MemoryStore.ts";

// Provider, config, admin
export { SettingsProvider } from "./provider/SettingsProvider.ts";
export { SettingsConfig } from "./config.ts";
export type { SettingsConfigShape } from "./config.ts";
export { SETTINGS_ABILITY } from "./admin.ts";

// Testing
export { SettingsFake } from "./SettingsFake.ts";

// Errors
export {
  SettingsError,
  UnknownSettingError,
  DuplicateSettingError,
  InvalidSettingValueError,
  SettingScopeError,
} from "./errors.ts";
