import { describe, it, expect } from "bun:test";
import { ConfigManager } from "@zerotal/core/config";
import { SessionConfig, validateSessionConfig } from "./config.ts";

const ctx = (isProduction: boolean) => ({
  namespace: "session",
  isProduction,
  config: new ConfigManager(),
});

describe("validateSessionConfig", () => {
  it("reports nothing outside production, even with insecure values", () => {
    expect(validateSessionConfig(SessionConfig(), ctx(false))).toEqual([]);
    expect(validateSessionConfig(undefined, ctx(false))).toEqual([]);
  });

  it("refuses default/absent config in production (placeholder secret + insecure cookie)", () => {
    const issues = validateSessionConfig(undefined, ctx(true)) ?? [];
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.level === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("session.secret"))).toBe(true);
    expect(issues.some((i) => i.message.includes("session.secure"))).toBe(true);
  });

  it("flags the placeholder secret in production", () => {
    const cfg = SessionConfig({ secret: "changeme", secure: true });
    const issues = validateSessionConfig(cfg, ctx(true)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("session.secret");
  });

  it("flags a non-secure cookie in production", () => {
    const cfg = SessionConfig({ secret: "a-real-strong-secret", secure: false });
    const issues = validateSessionConfig(cfg, ctx(true)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("session.secure");
  });

  it("passes a properly secured production config", () => {
    const cfg = SessionConfig({ secret: "a-real-strong-secret", secure: true });
    expect(validateSessionConfig(cfg, ctx(true))).toEqual([]);
  });
});
