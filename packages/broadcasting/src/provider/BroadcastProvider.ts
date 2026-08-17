import { ServiceProvider, Router, type Application, type Emitter } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import type { HttpContext } from "@zerotal/core";
import { BroadcastManager } from "../BroadcastManager.ts";
import { PusherCompatManager } from "../PusherCompatManager.ts";
import { RedisBroadcastDriver } from "../RedisBroadcastDriver.ts";
import { channelRegistry } from "../ChannelRegistry.ts";
import type { PresenceMemberData } from "../ChannelRegistry.ts";
import { broadcastOnce } from "../BroadcastingEvent.ts";
import type { BroadcastEvent } from "../types.ts";
import { BroadcastConfig, validateBroadcastConfig } from "../config.ts";
import type { BroadcastConfigShape } from "../config.ts";
import { frameworkLog } from "@zerotal/core/logger";

declare module "@zerotal/core" {
  interface ContainerBindings {
    broadcast: BroadcastManager;
  }
}

/** Where channel rules live when `config.broadcasting.channels` says nothing. */
const DEFAULT_CHANNELS_PATH = "routes/channels.ts";

/** POSIX `/…` and Windows `C:\…` both, since this joins a path by hand. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export class BroadcastProvider extends ServiceProvider {
  static override provides = ["broadcast"] as const;
  static override environments: AppEnvironment[] = ["web", "worker", "test", "console"];

  private _redisDriver: RedisBroadcastDriver | undefined;
  /** Resolved in `onRegister`, read in `onBooting`, so config is read once. */
  private _channelsPath = DEFAULT_CHANNELS_PATH;

  override onRegister(): void {
    // Refuse a production boot when the configured driver is missing the
    // credentials it cannot work without. Runs in the boot-time config pass.
    this.app.registerConfigValidator?.("broadcasting", validateBroadcastConfig);

    // The concrete manager must exist at registration time because the
    // WebSocket handlers and the Pusher auth route below are wired from it —
    // so config is resolved here rather than inside a lazy singleton closure.
    const configManager = this.app.container.tryMake("config") as ConfigManager | null;
    const raw = configManager?.get<Partial<BroadcastConfigShape>>("broadcasting") ?? {};
    const cfg = BroadcastConfig(raw);
    this._channelsPath = cfg.channels ?? DEFAULT_CHANNELS_PATH;

    let manager: BroadcastManager;

    if (cfg.driver === "redis") {
      const url = cfg.redis?.url ?? "redis://localhost:6379";
      const driver = new RedisBroadcastDriver(url);
      this._redisDriver = driver;
      manager = driver;
    } else if (cfg.driver === "pusher") {
      const { appKey = "", appSecret = "" } = cfg.pusher ?? {};
      manager = new PusherCompatManager(appKey, appSecret);
    } else {
      manager = new BroadcastManager();
    }

    this.app.container.value("broadcast", manager);

    if (cfg.driver === "ws" || cfg.driver === "redis" || cfg.driver === "pusher") {
      // Register at the configured path so this coexists with flow's `/__flow/ws` (multiplexed
      // by path). Pusher clients connect to a dynamic `/app/{APP_KEY}`, so register it catch-all.
      (this.app as unknown as Application).withWebSocket(
        manager.wsHandlers,
        (req) => manager.upgradeData(req),
        cfg.driver === "pusher" ? undefined : cfg.path,
      );
    }

    if (cfg.driver === "pusher") {
      const pusher = manager as PusherCompatManager;
      Router.post("/broadcasting/auth", _makePusherAuthController(pusher), "handle");
    } else if (cfg.driver === "ws" || cfg.driver === "redis") {
      // Native drivers: sign per-subscription auth tokens with the app's APP_KEY, and expose
      // the same `/broadcasting/auth` endpoint so the first-party `Socket` client can fetch a
      // Pusher-style signature for private/presence channels.
      const secret = configManager?.get<string>("app.key") ?? "";
      manager.setAuthSecret(secret);
      Router.post("/broadcasting/auth", _makeNativeAuthController(manager), "handle");
    }
  }

  override async onBooting(): Promise<void> {
    await this._redisDriver?.boot();

    // Auto-broadcast: any BroadcastingEvent emitted on this app's Events bus is
    // broadcast too. The hook lives on the app's own emitter, so it stays scoped
    // per application.
    const emitter = (await this.app.container.make("events")) as Emitter;
    emitter.setBroadcaster((event: object) => broadcastOnce(event as BroadcastEvent));

    await this._loadChannelRoutes();
  }

  override async onBooted(): Promise<void> {
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;
    runner.registerLazy("channel:list", () =>
      import("../commands/ChannelListCommand.ts").then((m) => m.ChannelListCommand),
    );
    runner.registerLazy("make:channel", () =>
      import("../commands/MakeChannelCommand.ts").then((m) => m.MakeChannelCommand),
    );
  }

  /**
   * Side-effect import of `routes/channels.ts` so its `Broadcast.channel(...)` authorization
   * rules register before the first `/broadcasting/auth` request. Missing file is fine.
   */
  private async _loadChannelRoutes(): Promise<void> {
    const configured = this._channelsPath;
    // Absolute stays as given; relative resolves from the project root, so an app
    // that keeps its routes under `app/routes` can point at
    // `app/routes/channels.ts` instead of growing a second `routes/` directory.
    const path = isAbsolutePath(configured) ? configured : `${process.cwd()}/${configured}`;
    try {
      if (await Bun.file(path).exists()) await import(path);
    } catch (err) {
      frameworkLog("broadcast").error(`Failed to load ${configured}`, undefined, err);
    }
  }

  override async onStopping(): Promise<void> {
    await this._redisDriver?.stop();
  }
}

// ── Auth controller factories ─────────────────────────────────────────────────

/**
 * Native (`ws` / `redis`) auth endpoint. Mirrors the Pusher flow: authorize via the
 * `routes/channels.ts` rules, then return an HMAC signature (and, for presence, the signed
 * `channel_data`) the `Socket` client echoes in its `subscribe` message.
 */
function _makeNativeAuthController(manager: BroadcastManager) {
  return class NativeBroadcastAuthController {
    async handle(http: HttpContext): Promise<void> {
      const { socket_id: socketId, channel_name: channelName } = await _parseAuthBody(http.request);

      if (!socketId || !channelName) {
        http.json({ error: "socket_id and channel_name are required" }, 400);
        return;
      }

      const auth = await channelRegistry.authorize(
        channelName,
        (http as unknown as { user?: unknown }).user,
      );
      if (!auth.matched) {
        http.json({ error: `No authorization rule registered for channel "${channelName}".` }, 403);
        return;
      }

      if (channelName.startsWith("presence-")) {
        const member = auth.result;
        if (!member || typeof member !== "object") {
          http.json({ error: "Unauthorized" }, 403);
          return;
        }
        const data = member as PresenceMemberData;
        // Native presence member shape is `{ id, info }`; the whole member object is the info.
        const channelData = JSON.stringify({ id: data.id, info: data });
        http.json({
          auth: manager.signAuth(socketId, channelName, channelData),
          channel_data: channelData,
        });
        return;
      }

      // Private channel — authorizer returns a boolean.
      if (!auth.result) {
        http.json({ error: "Unauthorized" }, 403);
        return;
      }
      http.json({ auth: manager.signAuth(socketId, channelName) });
    }
  };
}

function _makePusherAuthController(manager: PusherCompatManager) {
  return class PusherAuthController {
    async handle(http: HttpContext): Promise<void> {
      const { socket_id: socketId, channel_name: channelName } = await _parseAuthBody(http.request);

      if (!socketId || !channelName) {
        http.json({ error: "socket_id and channel_name are required" }, 400);
        return;
      }

      // Authorize via the routes/channels.ts rules. The authenticated user is whatever the
      // app's auth middleware put on the request (undefined for guests -> denied).
      const auth = await channelRegistry.authorize(
        channelName,
        (http as unknown as { user?: unknown }).user,
      );
      if (!auth.matched) {
        http.json({ error: `No authorization rule registered for channel "${channelName}".` }, 403);
        return;
      }

      if (channelName.startsWith("presence-")) {
        const member = auth.result;
        if (!member || typeof member !== "object") {
          http.json({ error: "Unauthorized" }, 403);
          return;
        }
        const data = member as PresenceMemberData;
        const channelData = JSON.stringify({ user_id: data.id, user_info: data });
        http.json({
          auth: manager.signAuth(socketId, channelName, channelData),
          channel_data: channelData,
        });
        return;
      }

      // Private channel — authorizer returns a boolean.
      if (!auth.result) {
        http.json({ error: "Unauthorized" }, 403);
        return;
      }
      http.json({ auth: manager.signAuth(socketId, channelName) });
    }
  };
}

/** Parse socket_id / channel_name from JSON or form-encoded body. */
async function _parseAuthBody(
  req: Request,
): Promise<{ socket_id?: string; channel_name?: string }> {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    try {
      return (await req.clone().json()) as { socket_id?: string; channel_name?: string };
    } catch {
      return {};
    }
  }

  try {
    const fd = await req.clone().formData();
    const result: { socket_id?: string; channel_name?: string } = {};
    const sid = fd.get("socket_id");
    const cname = fd.get("channel_name");
    if (sid !== null) result.socket_id = sid as string;
    if (cname !== null) result.channel_name = cname as string;
    return result;
  } catch {
    return {};
  }
}
