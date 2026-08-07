import { describe, it, expect } from "bun:test";
import { ConfigManager } from "./ConfigManager.ts";
import {
  runConfigValidators,
  ConfigValidationError,
  type RegisteredConfigValidator,
} from "./validation.ts";

function mgr(data: Record<string, Record<string, unknown>> = {}): ConfigManager {
  const m = new ConfigManager();
  for (const [ns, v] of Object.entries(data)) m.load(ns, v);
  return m;
}

describe("runConfigValidators", () => {
  it("passes silently when no validator reports an issue", () => {
    const validators: RegisteredConfigValidator[] = [
      { namespace: "session", validate: () => [] },
      { namespace: "app", validate: () => undefined },
    ];
    const warnings: string[] = [];
    expect(() =>
      runConfigValidators(validators, mgr(), true, (m) => warnings.push(m)),
    ).not.toThrow();
    expect(warnings).toEqual([]);
  });

  it("refuses a production boot on an error-level issue, naming the culprit", () => {
    const validators: RegisteredConfigValidator[] = [
      { namespace: "session", validate: () => [{ level: "error", message: "insecure secret" }] },
    ];
    let error: ConfigValidationError | undefined;
    try {
      runConfigValidators(validators, mgr(), true, () => {});
    } catch (e) {
      error = e as ConfigValidationError;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error!.code).toBe("E_CONFIG_VALIDATION_FAILED");
    expect(error!.issues).toEqual([{ namespace: "session", message: "insecure secret" }]);
    expect(error!.message).toContain("session");
    expect(error!.message).toContain("insecure secret");
  });

  it("only warns (never throws) on an error-level issue outside production", () => {
    const validators: RegisteredConfigValidator[] = [
      { namespace: "session", validate: () => [{ level: "error", message: "insecure secret" }] },
    ];
    const warnings: string[] = [];
    expect(() =>
      runConfigValidators(validators, mgr(), false, (m) => warnings.push(m)),
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("session");
    expect(warnings[0]).toContain("insecure secret");
  });

  it("treats warning-level issues as advisory in production (warn, never fatal)", () => {
    const validators: RegisteredConfigValidator[] = [
      { namespace: "app", validate: () => [{ level: "warning", message: "soft advice" }] },
    ];
    const warnings: string[] = [];
    expect(() =>
      runConfigValidators(validators, mgr(), true, (m) => warnings.push(m)),
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("soft advice");
  });

  it("passes the namespace value and context to each validator", () => {
    let seenValue: unknown;
    let seenCtx: { namespace: string; isProduction: boolean } | undefined;
    const validators: RegisteredConfigValidator[] = [
      {
        namespace: "session",
        validate: (value, ctx) => {
          seenValue = value;
          seenCtx = { namespace: ctx.namespace, isProduction: ctx.isProduction };
          return [];
        },
      },
    ];
    runConfigValidators(validators, mgr({ session: { secret: "abc" } }), true, () => {});
    expect(seenValue).toEqual({ secret: "abc" });
    expect(seenCtx).toEqual({ namespace: "session", isProduction: true });
  });

  it("aggregates every fatal issue across validators into one error", () => {
    const validators: RegisteredConfigValidator[] = [
      { namespace: "session", validate: () => [{ level: "error", message: "no secret" }] },
      {
        namespace: "app",
        validate: () => [
          { level: "error", message: "missing key" },
          { level: "warning", message: "advisory" },
        ],
      },
    ];
    const warnings: string[] = [];
    let error: ConfigValidationError | undefined;
    try {
      runConfigValidators(validators, mgr(), true, (m) => warnings.push(m));
    } catch (e) {
      error = e as ConfigValidationError;
    }
    // Two errors are fatal; the warning is logged, not fatal.
    expect(error!.issues).toHaveLength(2);
    expect(error!.issues.map((i) => i.namespace).sort()).toEqual(["app", "session"]);
    expect(warnings).toEqual(["[Zerotal] config(app): advisory"]);
  });
});
