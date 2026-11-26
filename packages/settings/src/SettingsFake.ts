import { Application, currentApp } from "@zerotal/core";
import { _definitionOf } from "./registry.ts";
import { SettingsManager } from "./SettingsManager.ts";
import type { ResolvedSetting } from "./SettingsManager.ts";
import type { SettingsScope } from "./scope.ts";
import { MemoryStore } from "./stores/MemoryStore.ts";
import type { StoredSetting } from "./stores/SettingsStore.ts";

/** One entry of the container's registry, as `install()` saves it and `restore()` puts it back. */
type RegistryEntry = Application["container"]["registry"] extends Map<unknown, infer B> ? B : never;

/**
 * Settings for a test: an in-memory store in place of the table, and a way to
 * pin a setting to a value whoever reads it.
 *
 * Everything else behaves as it does in the app — tenant and user overrides,
 * hiding, restoring, validation — so a test of those needs no database. A pinned
 * value is checked against its definition, and wins over every level until it is
 * released or the fake is restored.
 *
 * @example
 * const settings = SettingsFake.install({ "billing.paymentTermsDays": 7 });
 * expect(await billing.get("billing.paymentTermsDays")).toBe(7);
 * settings.restore(); // in afterEach
 */
export class SettingsFake extends SettingsManager {
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

  /** Replace the `settings` binding with a fake, pinning `overrides` from the start. */
  static install(overrides: Record<string, unknown> = {}): SettingsFake {
    const app = currentApp();
    const original = app.container.registry.get("settings");
    const fake = new SettingsFake(app, original, new MemoryStore());
    for (const [key, value] of Object.entries(overrides)) fake.override(key, value);
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
  override(key: string, value: unknown): this {
    this._pins.set(key, _definitionOf(key).parse(value, key));
    return this;
  }

  /** Release a pin, so the setting resolves normally again. */
  release(key: string): this {
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
