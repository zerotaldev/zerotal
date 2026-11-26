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
