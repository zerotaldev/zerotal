import { currentApp } from "@zerotal/core";
import { SettingsError } from "./errors.ts";
import { _registerSetting } from "./registry.ts";
import type { SettingDefinition } from "./setting.ts";
import type { SettingsScope } from "./scope.ts";
import type {
  ResolvedSetting,
  SettingHistoryEntry,
  SettingHistoryOptions,
  SettingWriteOptions,
  SettingsManager,
} from "./SettingsManager.ts";

/** A set of setting definitions, keyed by setting name. */
export type SettingDefinitions = Record<string, SettingDefinition<unknown>>;

/** The type a definition's value has. */
export type SettingValue<D> = D extends SettingDefinition<infer T> ? T : never;

/** Every value of a set of definitions, by key. */
export type SettingValues<D extends SettingDefinitions> = { [K in keyof D]: SettingValue<D[K]> };

/**
 * The typed handle `defineSettings()` returns: every read and write takes only
 * the keys it declares, and reads come back as the declared type.
 */
export interface SettingsGroup<D extends SettingDefinitions> {
  /** The definitions, as declared. */
  readonly definitions: D;
  /** A setting's value for the current tenant and user, or the ones `scope` names. */
  get<K extends keyof D & string>(key: K, scope?: SettingsScope): Promise<SettingValue<D[K]>>;
  /** Every setting in this group, for the current tenant and user. */
  all(scope?: SettingsScope): Promise<SettingValues<D>>;
  /** A value, the level it came from, and every level that applies. */
  explain<K extends keyof D & string>(
    key: K,
    scope?: SettingsScope,
  ): Promise<ResolvedSetting<SettingValue<D[K]>>>;
  /** Override at one level — the tenant's, by default inside a tenant. */
  set<K extends keyof D & string>(
    key: K,
    value: SettingValue<D[K]>,
    options?: SettingWriteOptions,
  ): Promise<void>;
  /** Stop an override applying, keeping it. `false` when there is none at that level. */
  hide<K extends keyof D & string>(key: K, options?: SettingWriteOptions): Promise<boolean>;
  /** Make a hidden override apply again. `false` when there is none at that level. */
  unhide<K extends keyof D & string>(key: K, options?: SettingWriteOptions): Promise<boolean>;
  /** The changes at one level, newest first, from the audit trail. */
  history<K extends keyof D & string>(
    key: K,
    options?: SettingHistoryOptions,
  ): Promise<SettingHistoryEntry[]>;
}

/** The `settings` binding, or an error naming the provider to register. */
function manager(): SettingsManager {
  try {
    return currentApp().container.makeSync<SettingsManager>("settings");
  } catch {
    throw new SettingsError(
      "Settings are not available: register SettingsProvider from @zerotal/settings.",
      "E_SETTINGS_NOT_REGISTERED",
    );
  }
}

/**
 * Declare settings: a typed default in code for each, and the levels that may
 * override it.
 *
 * Call it once per group, at module scope, and export the result. Every key is
 * registered with the settings screen as the module loads.
 *
 * @example
 * // app/settings.ts
 * import { defineSettings, setting } from "@zerotal/settings";
 *
 * export const billing = defineSettings({
 *   "billing.invoicePrefix": setting.string({ default: "INV-", maxLength: 8 }),
 *   "billing.paymentTermsDays": setting.number({ default: 30, min: 0, max: 120, integer: true }),
 * });
 *
 * const days = await billing.get("billing.paymentTermsDays"); // number
 */
export function defineSettings<const D extends SettingDefinitions>(
  definitions: D,
): SettingsGroup<D> {
  for (const [key, definition] of Object.entries(definitions)) _registerSetting(key, definition);

  return {
    definitions,
    async get(key, scope) {
      return (await manager().get(key, scope)) as SettingValue<D[typeof key]>;
    },
    async all(scope) {
      const resolved = await manager().resolveMany(Object.keys(definitions), scope);
      return Object.fromEntries(resolved.map((r) => [r.key, r.value])) as SettingValues<D>;
    },
    async explain(key, scope) {
      return (await manager().resolve(key, scope)) as ResolvedSetting<SettingValue<D[typeof key]>>;
    },
    set: (key, value, options) => manager().set(key, value, options),
    hide: (key, options) => manager().hide(key, options),
    unhide: (key, options) => manager().unhide(key, options),
    history: (key, options) => manager().history(key, options),
  };
}
