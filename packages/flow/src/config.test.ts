import { describe, expect, test } from "bun:test";
import { FlowConfig, DEFAULT_PERSISTENT_MIDDLEWARE } from "./config.ts";

describe("FlowConfig", () => {
  test("returns the defaults when called with no options", () => {
    const cfg = FlowConfig();

    expect(cfg.cspSafe).toBe(false);
    expect(cfg.persistentMiddleware).toEqual(DEFAULT_PERSISTENT_MIDDLEWARE);
  });

  test("applies overrides", () => {
    expect(FlowConfig({ cspSafe: true }).cspSafe).toBe(true);
  });

  test("overriding one key keeps the other default", () => {
    const cfg = FlowConfig({ cspSafe: true });

    expect(cfg.persistentMiddleware).toEqual(DEFAULT_PERSISTENT_MIDDLEWARE);
  });

  test("a supplied middleware list replaces the defaults rather than merging into them", () => {
    const cfg = FlowConfig({ persistentMiddleware: ["TenantMiddleware"] });

    expect(cfg.persistentMiddleware).toEqual(["TenantMiddleware"]);
  });

  test("never aliases the shared defaults", () => {
    const first = FlowConfig();
    first.persistentMiddleware.push("LocaleMiddleware");

    expect(FlowConfig().persistentMiddleware).toEqual(DEFAULT_PERSISTENT_MIDDLEWARE);
    expect(DEFAULT_PERSISTENT_MIDDLEWARE).not.toContain("LocaleMiddleware");
  });
});
