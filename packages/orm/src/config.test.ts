import { describe, it, expect } from "bun:test";
import { ConfigManager } from "@zerotal/core/config";
import { DatabaseConfig, validateDatabaseConfig } from "./config.ts";

const ctx = (isProduction: boolean) => ({
  namespace: "database",
  isProduction,
  config: new ConfigManager(),
});

describe("validateDatabaseConfig", () => {
  it("passes the sqlite defaults in any environment", () => {
    expect(validateDatabaseConfig(DatabaseConfig(), ctx(false))).toEqual([]);
    expect(validateDatabaseConfig(DatabaseConfig(), ctx(true))).toEqual([]);
    expect(validateDatabaseConfig(undefined, ctx(true))).toEqual([]);
  });

  it("rejects an unknown driver", () => {
    const cfg = DatabaseConfig({ driver: "oracle" as never });
    const issues = validateDatabaseConfig(cfg, ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("error");
    expect(issues[0]!.message).toContain("database.driver");
  });

  it("rejects a postgres driver whose url is not a postgres URL", () => {
    const cfg = DatabaseConfig({ driver: "postgres", url: "./database/db.sqlite" });
    const issues = validateDatabaseConfig(cfg, ctx(false)) ?? [];
    expect(issues.some((i) => i.level === "error" && i.message.includes("postgres://"))).toBe(true);
  });

  it("accepts postgres:// and postgresql:// URLs for the postgres driver", () => {
    for (const url of ["postgres://u:p@host/db", "postgresql://u:p@host/db"]) {
      expect(
        validateDatabaseConfig(DatabaseConfig({ driver: "postgres", url }), ctx(true)),
      ).toEqual([]);
    }
  });

  it("rejects a mysql driver whose url is not a mysql URL", () => {
    const cfg = DatabaseConfig({ driver: "mysql", url: "postgres://u:p@host/db" });
    const issues = validateDatabaseConfig(cfg, ctx(false)) ?? [];
    expect(issues.some((i) => i.level === "error" && i.message.includes("mysql://"))).toBe(true);
  });

  it("rejects a sqlite driver pointed at a network URL", () => {
    const cfg = DatabaseConfig({ driver: "sqlite", url: "postgres://u:p@host/db" });
    const issues = validateDatabaseConfig(cfg, ctx(false)) ?? [];
    expect(issues.some((i) => i.level === "error" && i.message.includes("network"))).toBe(true);
  });

  it("warns on an in-memory database in production only", () => {
    const cfg = DatabaseConfig({ url: ":memory:", sqlite: { path: ":memory:" } });
    expect(validateDatabaseConfig(cfg, ctx(false))).toEqual([]);
    const issues = validateDatabaseConfig(cfg, ctx(true)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warning");
    expect(issues[0]!.message).toContain("in-memory");
  });

  it("warns that synchronize does nothing in production", () => {
    for (const synchronize of [true, { enabled: true }] as const) {
      const cfg = DatabaseConfig({ synchronize });
      const issues = validateDatabaseConfig(cfg, ctx(true)) ?? [];
      expect(issues).toHaveLength(1);
      expect(issues[0]!.level).toBe("warning");
      expect(issues[0]!.message).toContain("synchronize");
    }
    expect(validateDatabaseConfig(DatabaseConfig({ synchronize: false }), ctx(true))).toEqual([]);
  });

  it("flags replica misconfiguration", () => {
    const onSqlite =
      validateDatabaseConfig(DatabaseConfig({ replicas: ["./replica.sqlite"] }), ctx(false)) ?? [];
    expect(onSqlite.some((i) => i.level === "warning" && i.message.includes("replicas"))).toBe(
      true,
    );

    const emptyEntry =
      validateDatabaseConfig(
        DatabaseConfig({ driver: "postgres", url: "postgres://u:p@host/db", replicas: [""] }),
        ctx(false),
      ) ?? [];
    expect(emptyEntry.some((i) => i.level === "error" && i.message.includes("empty"))).toBe(true);
  });
});
