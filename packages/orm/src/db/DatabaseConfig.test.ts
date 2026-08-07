import { describe, it, expect } from "bun:test";
import { DatabaseConfig } from "../config.ts";

describe("DatabaseConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = DatabaseConfig();
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.url).toBe("./database/db.sqlite");
    expect(cfg.sqlite.path).toBe("./database/db.sqlite");
  });

  it("overrides work", () => {
    const cfg = DatabaseConfig({ url: ":memory:" });
    expect(cfg.url).toBe(":memory:");
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.sqlite.path).toBe("./database/db.sqlite");
  });

  it("deep-merges sqlite options", () => {
    const cfg = DatabaseConfig({ sqlite: { path: ":memory:" } });
    expect(cfg.sqlite.path).toBe(":memory:");
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.url).toBe("./database/db.sqlite");
  });
});
