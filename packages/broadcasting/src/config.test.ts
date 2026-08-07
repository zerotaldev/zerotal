import { describe, it, expect } from "bun:test";
import { ConfigManager } from "@zerotal/core/config";
import { BroadcastConfig, validateBroadcastConfig } from "./config.ts";

const ctx = (isProduction: boolean) => ({
  namespace: "broadcasting",
  isProduction,
  config: new ConfigManager(),
});

describe("validateBroadcastConfig", () => {
  it("passes the defaults and the ws driver", () => {
    expect(validateBroadcastConfig(BroadcastConfig(), ctx(true))).toEqual([]);
    expect(validateBroadcastConfig(BroadcastConfig({ driver: "ws" }), ctx(true))).toEqual([]);
    expect(validateBroadcastConfig(undefined, ctx(true))).toEqual([]);
  });

  it("rejects an unknown driver", () => {
    const issues =
      validateBroadcastConfig(BroadcastConfig({ driver: "kafka" as never }), ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("error");
  });

  it("requires redis.url for the redis driver", () => {
    const issues = validateBroadcastConfig(BroadcastConfig({ driver: "redis" }), ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("error");
    expect(issues[0]!.message).toContain("redis.url");
  });

  it("requires a redis:// or rediss:// protocol on redis.url", () => {
    const bad =
      validateBroadcastConfig(
        BroadcastConfig({ driver: "redis", redis: { url: "localhost:6379" } }),
        ctx(false),
      ) ?? [];
    expect(bad.some((i) => i.level === "error")).toBe(true);

    for (const url of ["redis://localhost:6379", "rediss://cache.internal:6380"]) {
      expect(
        validateBroadcastConfig(BroadcastConfig({ driver: "redis", redis: { url } }), ctx(true)),
      ).toEqual([]);
    }
  });

  it("requires both pusher credentials for the pusher driver", () => {
    const missing =
      validateBroadcastConfig(
        BroadcastConfig({ driver: "pusher", pusher: { appKey: "k", appSecret: "" } }),
        ctx(false),
      ) ?? [];
    expect(missing).toHaveLength(1);
    expect(missing[0]!.level).toBe("error");

    expect(
      validateBroadcastConfig(
        BroadcastConfig({ driver: "pusher", pusher: { appKey: "k", appSecret: "s" } }),
        ctx(true),
      ),
    ).toEqual([]);
  });
});
