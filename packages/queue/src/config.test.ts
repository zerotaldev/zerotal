import { describe, it, expect } from "bun:test";
import { ConfigManager } from "@zerotal/core/config";
import { QueueConfig, validateQueueConfig } from "./config.ts";

const ctx = (isProduction: boolean) => ({
  namespace: "queue",
  isProduction,
  config: new ConfigManager(),
});

describe("validateQueueConfig", () => {
  it("passes the defaults in any environment", () => {
    expect(validateQueueConfig(QueueConfig(), ctx(false))).toEqual([]);
    expect(validateQueueConfig(QueueConfig(), ctx(true))).toEqual([]);
    expect(validateQueueConfig(undefined, ctx(true))).toEqual([]);
  });

  it("rejects an unknown driver", () => {
    const issues =
      validateQueueConfig(QueueConfig({ driver: "rabbitmq" as never }), ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("error");
  });

  it("rejects a poll interval that would busy-loop", () => {
    for (const pollInterval of [0, -5, Number.NaN]) {
      const issues = validateQueueConfig(QueueConfig({ pollInterval }), ctx(false)) ?? [];
      expect(issues.some((i) => i.level === "error" && i.message.includes("pollInterval"))).toBe(
        true,
      );
    }
  });

  it("requires workerBootstrap when workers are enabled", () => {
    const missing = validateQueueConfig(QueueConfig({ workers: 2 }), ctx(false)) ?? [];
    expect(missing).toHaveLength(1);
    expect(missing[0]!.level).toBe("error");
    expect(missing[0]!.message).toContain("workerBootstrap");

    expect(
      validateQueueConfig(
        QueueConfig({ workers: 2, workerBootstrap: "file:///app/bootstrap/queue-worker.ts" }),
        ctx(true),
      ),
    ).toEqual([]);
  });

  it("rejects a negative or fractional worker count", () => {
    for (const workers of [-1, 1.5]) {
      const issues = validateQueueConfig(QueueConfig({ workers }), ctx(false)) ?? [];
      expect(issues.some((i) => i.level === "error" && i.message.includes("workers"))).toBe(true);
    }
  });

  it("warns on an empty queue list", () => {
    const issues = validateQueueConfig(QueueConfig({ queues: [] }), ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warning");
  });

  it("warns on the sync driver in production only", () => {
    const cfg = QueueConfig({ driver: "sync" });
    expect(validateQueueConfig(cfg, ctx(false))).toEqual([]);
    const issues = validateQueueConfig(cfg, ctx(true)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warning");
  });
});
