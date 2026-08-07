import { describe, it, expect } from "bun:test";
import { ConfigManager } from "./ConfigManager.ts";
import { ConfigError } from "../errors/ConfigError.ts";
import { AppConfig } from "./AppConfig.ts";

describe("ConfigManager — load and get", () => {
  it("gets a top-level namespace value", () => {
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal", debug: false });
    expect(c.get("app.name")).toBe("Zerotal");
  });

  it("gets a nested value with dot notation", () => {
    const c = new ConfigManager();
    c.load("database", { connections: { postgres: { url: "postgres://localhost" } } });
    expect(c.get("database.connections.postgres.url")).toBe("postgres://localhost");
  });

  it("returns fallback for missing key", () => {
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal" });
    expect(c.get("app.missing", "default")).toBe("default");
  });

  it("returns undefined for missing key with no fallback", () => {
    const c = new ConfigManager();
    expect(c.get("app.name")).toBeUndefined();
  });

  it("has() returns true for set keys", () => {
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal" });
    expect(c.has("app.name")).toBe(true);
    expect(c.has("app.missing")).toBe(false);
  });
});

describe("ConfigManager — require()", () => {
  it("returns the value when set", () => {
    const c = new ConfigManager();
    c.load("app", { key: "secret" });
    expect(c.require("app.key")).toBe("secret");
  });

  it("throws ConfigError when key is missing", () => {
    const c = new ConfigManager();
    expect(() => c.require("app.key")).toThrow(ConfigError);
  });
});

describe("ConfigManager — set()", () => {
  it("sets a nested value at runtime", () => {
    const c = new ConfigManager();
    c.set("app.name", "Override");
    expect(c.get("app.name")).toBe("Override");
  });

  it("set() does not clobber sibling keys", () => {
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal", debug: false });
    c.set("app.name", "Override");
    expect(c.get("app.debug")).toBe(false); // sibling preserved
  });
});

describe("ConfigManager — all()", () => {
  it("returns a copy of all loaded config", () => {
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal" });
    const all = c.all();
    expect(all["app"]).toEqual({ name: "Zerotal" });
  });
});

describe("ConfigManager — get() early-return path", () => {
  it("returns fallback when traversal hits a non-object mid-path", () => {
    // 'app.name' is 'Zerotal' (a string), so 'app.name.extra' should hit the
    // early-return branch: typeof current !== 'object'
    const c = new ConfigManager();
    c.load("app", { name: "Zerotal" });
    expect(c.get("app.name.extra", "fallback")).toBe("fallback");
  });

  it("returns undefined when traversal hits null mid-path", () => {
    const c = new ConfigManager();
    c.load("app", { nested: null });
    expect(c.get("app.nested.deep")).toBeUndefined();
  });
});

// ── AppConfig() ───────────────────────────────────────────────────────────────

describe("AppConfig()", () => {
  it("returns defaults when called with no options", () => {
    const cfg = AppConfig({});
    expect(cfg.name).toBe("Zerotal App");
    expect(cfg.port).toBe(3000);
    expect(cfg.locale).toBe("en");
    expect(cfg.timezone).toBe("UTC");
    expect(cfg.http3).toBe(false);
    expect(cfg.health).toBe(false);
  });

  it("overrides name, port, locale, timezone", () => {
    const cfg = AppConfig({ name: "My App", port: 8080, locale: "fr", timezone: "Europe/Paris" });
    expect(cfg.name).toBe("My App");
    expect(cfg.port).toBe(8080);
    expect(cfg.locale).toBe("fr");
    expect(cfg.timezone).toBe("Europe/Paris");
  });

  it("overrides url and key", () => {
    const cfg = AppConfig({ url: "https://example.com", key: "secret-key" });
    expect(cfg.url).toBe("https://example.com");
    expect(cfg.key).toBe("secret-key");
  });

  it("sets debug from option", () => {
    const cfg = AppConfig({ debug: false });
    expect(cfg.debug).toBe(false);
  });

  it("enables http3 and health check", () => {
    const cfg = AppConfig({ http3: true, health: true });
    expect(cfg.http3).toBe(true);
    expect(cfg.health).toBe(true);
  });

  it("sets tls config", () => {
    const cfg = AppConfig({ tls: { cert: "/etc/ssl/cert.pem", key: "/etc/ssl/key.pem" } });
    expect(cfg.tls!.cert).toBe("/etc/ssl/cert.pem");
    expect(cfg.tls!.key).toBe("/etc/ssl/key.pem");
  });

  it("does not include tls when not specified", () => {
    const cfg = AppConfig({});
    expect(cfg.tls).toBeUndefined();
  });
});

describe("ConfigManager.set() — prototype pollution", () => {
  it("refuses to write through __proto__, constructor or prototype", () => {
    const config = new ConfigManager({});
    for (const path of [
      "__proto__.isAdmin",
      "app.__proto__.isAdmin",
      "constructor.prototype.isAdmin",
      "a.prototype.b",
    ]) {
      expect(() => config.set(path, true)).toThrow();
    }
    // The decisive assertion: nothing leaked onto Object.prototype.
    expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
  });

  it("still writes ordinary nested paths", () => {
    const config = new ConfigManager({});
    config.set("app.debug", true);
    config.set("db.pool.max", 10);
    expect(config.get("app.debug")).toBe(true);
    expect(config.get("db.pool.max")).toBe(10);
  });
});
