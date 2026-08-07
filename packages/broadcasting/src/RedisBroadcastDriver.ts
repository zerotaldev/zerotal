import { RedisClient } from "bun";
import { BroadcastManager } from "./BroadcastManager.ts";
import { frameworkLog } from "@zerotal/core/logger";

const TOPIC = "__zerotal:broadcast";

interface Envelope {
  channel: string;
  event: string;
  data: unknown;
  /**
   * The originating connection, when the broadcast came from `toOthers()`.
   *
   * It has to cross the pub/sub hop: the socket to exclude is connected to whichever node
   * published, and every *other* node has to know to skip it too — or rather, has to know
   * that it does not hold it. Without this field the exclusion could not survive the hop
   * even in principle, so `toOthers()` was a silent no-op on the driver documented for
   * horizontal scaling, and every optimistic update double-applied in production.
   */
  exceptSocketId?: string;
}

/**
 * Redis-backed broadcast driver for horizontal scaling.
 *
 * Extends `BroadcastManager` and overrides `to()` to publish through
 * Redis Pub/Sub instead of writing directly to local WebSocket connections.
 * Every server instance subscribes on `__zerotal:broadcast` and delivers
 * incoming messages to its own local WS clients.
 *
 * Result: a broadcast on Server A is received by subscribers on Server B,
 * Server C, etc. — no direct server-to-server connection needed.
 *
 * Architecture:
 *
 *   Server A                   Redis                    Server B
 *   ─────────────────          ──────────────           ─────────────────
 *   Broadcast.to(ch, ev)
 *     → pub.publish(TOPIC) ──► fan-out ───────────────► sub.subscribe cb
 *                          ◄───────────────────────────  super.to() → ws
 *
 * The publishing server also receives its own message via the subscriber,
 * so all delivery — local or remote — flows through the same path.
 *
 * @example
 * // config/broadcasting.ts
 * export default BroadcastConfig({
 *   driver: 'redis',
 *   redis:  { url: Bun.env.REDIS_URL ?? 'redis://localhost:6379' },
 * });
 */
export class RedisBroadcastDriver extends BroadcastManager {
  private _pub!: RedisClient;
  private _sub!: RedisClient;

  constructor(private readonly _url: string) {
    super();
  }

  /**
   * Open the pub + sub connections and start listening for cross-server
   * broadcasts. Call once during application boot.
   *
   * If `_pub`/`_sub` are already set (e.g. injected in tests), this method
   * skips creating new clients and only registers the subscriber callback.
   */
  async boot(): Promise<void> {
    if (!this._pub) {
      this._pub = new RedisClient(this._url);
      // Bun.Redis cannot publish and subscribe on the same connection.
      // duplicate() creates a new independent connection with the same URL.
      this._sub = await this._pub.duplicate();
    }

    await this._sub.subscribe(TOPIC, (msg: string) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(msg) as Envelope;
      } catch {
        return;
      }
      // Deliver to local WebSocket clients on this server instance.
      // super.to() bypasses our Redis override so we don't re-publish. The exclusion is
      // applied on every node: only one of them holds that connection, and the others
      // simply have nothing matching to skip.
      super.to(
        envelope.channel,
        envelope.event,
        envelope.data,
        envelope.exceptSocketId ? { exceptSocketId: envelope.exceptSocketId } : undefined,
      );
    });
  }

  /** Unsubscribe the Redis listener. Called when the application stops. */
  async stop(): Promise<void> {
    await this._sub.unsubscribe(TOPIC);
  }

  /**
   * Publish the event to Redis instead of delivering locally.
   * All server instances — including this one — receive it through
   * the subscriber and deliver it to their own local WS clients.
   */
  override to(
    channel: string,
    event: string,
    data: unknown = {},
    opts?: { exceptSocketId?: string },
  ): void {
    const msg = JSON.stringify({
      channel,
      event,
      data,
      ...(opts?.exceptSocketId ? { exceptSocketId: opts.exceptSocketId } : {}),
    } satisfies Envelope);
    this._pub.publish(TOPIC, msg).catch((err: Error) => {
      frameworkLog("broadcast").error("Redis publish failed", undefined, err);
    });
  }
}
