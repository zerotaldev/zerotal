import { Application, currentApp } from "@zerotal/core";
import type { SettingDefinitions, SettingValue, SettingValues } from "./defineSettings.ts";
import { _definitionOf } from "./registry.ts";
import { SettingsManager } from "./SettingsManager.ts";
import type { ResolvedSetting } from "./SettingsManager.ts";
import type { SettingsScope } from "./scope.ts";
import { MemoryStore } from "./stores/MemoryStore.ts";
import type { StoredSetting } from "./stores/SettingsStore.ts";

/** One entry of the container's registry, as `install()` saves it and `restore()` puts it back. */
type RegistryEntry = Application["container"]["registry"] extends Map<unknown, infer B> ? B : never;

/**
 * Anything carrying setting definitions: what `defineSettings()` returns, or a
 * plain `{ definitions }`. Structural, so the fake does not depend on the group's
 * methods.
 */
interface DefinesSettings<D extends SettingDefinitions = SettingDefinitions> {
  readonly definitions: D;
}

/** Every key of several groups, with each key's own type. */
type MergedDefinitions<G extends readonly DefinesSettings[]> = _Intersect<G[number]["definitions"]>;

/** A union of definition sets, as one set holding every key. */
type _Intersect<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void
  ? I extends SettingDefinitions
    ? I
    : never
  : never;

function _isGroup(value: unknown): value is DefinesSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "definitions" in value &&
    typeof value.definitions === "object" &&
    value.definitions !== null &&
    "get" in value &&
    typeof value.get === "function"
  );
}

/**
 * Settings for a test: an in-memory store in place of the table, and a way to
 * pin a setting to a value whoever reads it.
 *
 * Everything else behaves as it does in the app — tenant and user overrides,
 * hiding, restoring, validation — so a test of those needs no database. A pinned
 * value is checked against its definition, and wins over every level until it is
 * released or the fake is restored.
 *
 * Given the groups `defineSettings()` returned, the fake takes only their keys,
 * and each value as its declared type, the way the groups themselves do. Given
 * none, it takes any key and checks it when the test runs.
 *
 * @example
 * const settings = SettingsFake.install(billing, { "billing.paymentTermsDays": 7 });
 * expect(await billing.get("billing.paymentTermsDays")).toBe(7);
 * settings.override("billing.paymentTermsDays", "7"); // type error: a number
 * settings.restore(); // in afterEach
 */
export class SettingsFake<
  D extends SettingDefinitions = SettingDefinitions,
> extends SettingsManager {
  /** The store behind the fake, for asserting on what was written. */
  readonly memory: MemoryStore;
  private readonly _pins = new Map<string, unknown>();
  private readonly _app: Application;
  private readonly _original: RegistryEntry | undefined;

  private constructor(app: Application, original: RegistryEntry | undefined, store: MemoryStore) {
    super(store, { audit: false });
    this.memory = store;
    this._app = app;
    this._original = original;
  }

  /**
   * Replace the `settings` binding with a fake, pinning `overrides` from the start.
   *
   * Pass the group `defineSettings()` returned (or several, in an array) first, and
   * the overrides and every later `override()` and `release()` are checked against
   * its keys and value types at compile time. With overrides alone, keys are checked
   * when the test runs.
   */
  static install<G extends DefinesSettings>(
    group: G,
    overrides?: Partial<SettingValues<G["definitions"]>> | undefined,
  ): SettingsFake<G["definitions"]>;
  static install<const G extends readonly DefinesSettings[]>(
    groups: G,
    overrides?: Partial<SettingValues<MergedDefinitions<G>>> | undefined,
  ): SettingsFake<MergedDefinitions<G>>;
  static install(overrides?: Record<string, unknown> | undefined): SettingsFake;
  static install(
    groupsOrOverrides?: DefinesSettings | readonly DefinesSettings[] | Record<string, unknown>,
    overrides?: Record<string, unknown>,
  ): SettingsFake {
    const typed = Array.isArray(groupsOrOverrides) || _isGroup(groupsOrOverrides);
    const pins =
      (typed ? overrides : (groupsOrOverrides as Record<string, unknown> | undefined)) ?? {};
    const app = currentApp();
    const original = app.container.registry.get("settings");
    const fake = new SettingsFake(app, original, new MemoryStore());
    for (const [key, value] of Object.entries(pins)) fake.override(key, value);
    app.container.value("settings", fake);
    return fake;
  }

  /** Restore the original `settings` binding. Call in afterEach. */
  restore(): void {
    if (this._original !== undefined) {
      this._app.container.registry.set("settings", this._original);
    } else {
      this._app.container.registry.delete("settings");
    }
  }

  /**
   * Pin a setting to `value` for every reader, above every stored level. The value
   * must fit the setting's definition, so a test cannot pin what the app could
   * never hold.
   */
  override<K extends keyof D & string>(key: K, value: SettingValue<D[K]>): this {
    this._pins.set(key, _definitionOf(key).parse(value, key));
    return this;
  }

  /** Release a pin, so the setting resolves normally again. */
  release<K extends keyof D & string>(key: K): this {
    this._pins.delete(key);
    return this;
  }

  /** Every override written through the fake, hidden ones included. */
  stored(): StoredSetting[] {
    return this.memory.all();
  }

  override async resolveMany(
    keys: readonly string[],
    scope?: SettingsScope,
  ): Promise<ResolvedSetting[]> {
    const resolved = await super.resolveMany(keys, scope);
    return resolved.map((r) =>
      this._pins.has(r.key) ? { ...r, value: this._pins.get(r.key), source: "override" } : r,
    );
  }
}
