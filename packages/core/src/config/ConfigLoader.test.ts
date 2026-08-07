import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { configLoader, ConfigLoader } from "./ConfigLoader.ts";
import { Application } from "../application/Application.ts";

const dir = `${import.meta.dir}/__fixtures__/config`;

describe("configLoader", () => {
  it("loads config files keyed by filename (sync, top-level safe)", () => {
    const config = configLoader(dir);
    expect(config).toBeInstanceOf(ConfigLoader);
    expect(config.get("app.name")).toBe("TestApp");
    expect(config.get("database.url")).toBe(":memory:");
    expect(config.get("app.conventions.enabled")).toBe(true);
    expect(config.get("missing.key", "fallback")).toBe("fallback");
    expect(config.has("database.url")).toBe(true);
    expect(config.has("database.nope")).toBe(false);
    expect(config.all().app).toEqual({
      name: "TestApp",
      conventions: { enabled: true, paths: { models: "app/models" } },
    });
  });

  it("runs per-file validate() exports", () => {
    expect(() => configLoader(dir).validate()).not.toThrow();
  });

  it("returns an empty map for a missing directory", () => {
    expect(configLoader(`${import.meta.dir}/__fixtures__/nope`).all()).toEqual({});
  });
});

describe("Application config source guard", () => {
  beforeEach(() => Application._resetInstance());
  afterEach(() => Application._resetInstance());

  it("accepts a ConfigLoader passed to create()", () => {
    const app = Application.create({ config: configLoader(dir) });
    expect(app).toBeDefined();
  });

  it("accepts config via the options form", () => {
    const app = Application.create({ config: configLoader(dir).all(), env: "test" });
    expect(app).toBeDefined();
  });

  it("ignores useConfig() when config was provided to create() (create wins)", () => {
    const app = Application.create({ config: configLoader(dir), env: "test" });
    // zerotal.ts always calls useConfig(); it must be a safe no-op here, not a throw.
    expect(() => app.useConfig({ app: { name: "Override" } })).not.toThrow();
    expect(app.useConfig({ app: { name: "Override" } })).toBe(app); // chainable, no-op
  });

  it("allows useConfig() when create() got no config", () => {
    const app = Application.create({ env: "test" });
    expect(() => app.useConfig(configLoader(dir))).not.toThrow();
  });
});
