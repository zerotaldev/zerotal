import { deepMerge } from "@zerotal/core";
import type { ConfigValidator, ConfigIssue } from "@zerotal/core/config";

export interface BroadcastConfigShape {
  /** WebSocket upgrade path. Default: '/app/ws'. For the pusher driver, clients connect to /app/{APP_KEY}. */
  path: string;
  /**
   * Broadcast driver.
   *  - `'null'`   - disabled (default)
   *  - `'ws'`     - single-server in-process WebSocket (Zerotal native protocol)
   *  - `'redis'`  - Redis Pub/Sub fan-out for horizontal scaling (Zerotal native protocol)
   *  - `'pusher'` - Pusher-compatible wire protocol (works with any Pusher-protocol client)
   */
  driver: "null" | "ws" | "redis" | "pusher";
  /**
   * Redis connection options - required when driver is `'redis'`.
   * @example
   * redis: { url: Bun.env.REDIS_URL ?? 'redis://localhost:6379' }
   */
  redis?: { url: string };
  /**
   * Pusher credentials - required when driver is `'pusher'`.
   * Configure a Pusher-compatible client to connect to ws://host/app/{appKey}.
   * @example
   * pusher: {
   *   appKey:    Bun.env.PUSHER_APP_KEY!,
   *   appSecret: Bun.env.PUSHER_APP_SECRET!,
   * }
   */
  pusher?: {
    appKey: string;
    appSecret: string;
  };
  /**
   * Where the `Broadcast.channel(...)` authorization rules live, relative to the
   * project root (or absolute).
   *
   * Defaults to `routes/channels.ts`. Set it when the app keeps its routes
   * somewhere else — an app that scaffolded its HTTP routes into `app/routes`
   * would otherwise grow a second, unrelated `routes/` directory holding one
   * file.
   *
   * @example
   * channels: "app/routes/channels.ts"
   */
  channels?: string;
}

const defaults: BroadcastConfigShape = {
  path: "/app/ws",
  driver: "null",
};

export function BroadcastConfig(
  overrides: Partial<BroadcastConfigShape> = {},
): BroadcastConfigShape {
  return deepMerge(defaults, overrides);
}

const DRIVERS = new Set<string>(["null", "ws", "redis", "pusher"]);

/**
 * Validate the `broadcasting` config namespace at boot. A driver whose required
 * credentials are missing can never deliver a message, so those are errors in
 * any environment. Registered by {@link BroadcastProvider} via
 * `app.registerConfigValidator("broadcasting", …)`.
 */
export const validateBroadcastConfig: ConfigValidator = (value) => {
  const cfg = value as Partial<BroadcastConfigShape> | undefined;
  const issues: ConfigIssue[] = [];
  const driver = cfg?.driver ?? "null";

  if (!DRIVERS.has(driver)) {
    issues.push({
      level: "error",
      message: `broadcasting.driver "${driver}" is unknown — use "null", "ws", "redis", or "pusher".`,
    });
    return issues;
  }

  if (driver === "redis") {
    const url = cfg?.redis?.url ?? "";
    if (url.length === 0) {
      issues.push({
        level: "error",
        message:
          'broadcasting.driver is "redis" but broadcasting.redis.url is unset — an unset ' +
          "REDIS_URL is the usual culprit. Point it at the Redis instance all servers share.",
      });
    } else if (!/^rediss?:\/\//.test(url)) {
      issues.push({
        level: "error",
        message:
          "broadcasting.redis.url does not start with redis:// (or rediss:// for TLS) — " +
          "set a full Redis connection URL.",
      });
    }
  }

  if (driver === "pusher") {
    if (!cfg?.pusher?.appKey || !cfg.pusher.appSecret) {
      issues.push({
        level: "error",
        message:
          'broadcasting.driver is "pusher" but pusher.appKey/appSecret are not both set — ' +
          "clients cannot authenticate to private channels without them.",
      });
    }
  }

  return issues;
};

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    broadcasting: BroadcastConfigShape;
  }
}
