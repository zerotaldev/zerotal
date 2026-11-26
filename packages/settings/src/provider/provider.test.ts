import { describe, it, expect } from "bun:test";
import type { ConcernDescriptor } from "@zerotal/core";
import { SettingsProvider } from "./SettingsProvider.ts";
import { SettingsManager } from "../SettingsManager.ts";

function register(config: Record<string, unknown> = {}) {
  const concerns: ConcernDescriptor[] = [];
  let factory: (() => unknown) | undefined;
  const container = {
    singleton: (_key: string, f: () => unknown) => {
      factory = f;
    },
    makeSync: () => ({
      get: (path: string, fallback?: unknown) => (path in config ? config[path] : fallback),
    }),
  };
  const app = { container, registerConcern: (c: ConcernDescriptor) => concerns.push(c) };
  new SettingsProvider(app as never).onRegister();
  return { concerns, factory: factory! };
}

describe("SettingsProvider", () => {
  it("binds settings to a manager", () => {
    expect(register().factory()).toBeInstanceOf(SettingsManager);
  });

  it("provisions its table on boot rather than asking for a migration", () => {
    expect(register().concerns.map((c) => c.name)).toEqual(["settings-schema"]);
  });

  it("passes the audit switch from config to the manager", () => {
    const manager = register({ "settings.audit": false }).factory() as {
      options: { audit: boolean };
    };
    expect(manager.options.audit).toBe(false);
  });
});

// The typed groups and the `Settings` facade read the binding with `makeSync`, which
// only returns a singleton something has already resolved. The provider registered
// it lazily and never resolved it, so in a real app every `billing.get(…)` threw
// "Settings are not available" with the provider registered: the tests here used a
// stubbed container and `SettingsFake`, and neither goes through that path.
describe("SettingsProvider in a real container", () => {
  it("has the manager resolved once it has booted, for makeSync readers", async () => {
    const { Application } = await import("@zerotal/core");
    const app = Application.create({ env: "test" });
    try {
      if (!app.container.bound("config")) {
        app.container.value("config", { get: (_path: string, fallback?: unknown) => fallback });
      }
      const provider = new SettingsProvider(app);
      provider.onRegister();
      await provider.onBooting();
      await provider.onBooted();
      expect(app.container.makeSync("settings")).toBeInstanceOf(SettingsManager);
    } finally {
      (Application as unknown as { _resetInstance(): void })._resetInstance();
    }
  });
});
