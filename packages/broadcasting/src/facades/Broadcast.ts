import { currentApp } from "@zerotal/core";
import { BroadcastProviderNotRegisteredError } from "../errors.ts";
import { BroadcastFake } from "../BroadcastFake.ts";
import { channelRegistry } from "../ChannelRegistry.ts";
import type { ChannelCallback } from "../ChannelRegistry.ts";
import { AnonymousBroadcast } from "../AnonymousBroadcast.ts";
import { privateChannel, presenceChannel } from "../Channel.ts";
import type { BroadcastManager } from "../BroadcastManager.ts";
import type { BroadcastEvent } from "../types.ts";
import type { PresenceMember } from "../BroadcastManager.ts";

/**
 * Test-only override. When set by `Broadcast.fake()`, it takes priority over the
 * container binding so tests can assert broadcasts without a live driver. This
 * is the package's single documented test hatch (cf. `DB._connection`); the
 * container remains the source of truth in production.
 */
let _fake: BroadcastFake | null = null;

/**
 * Broadcast facade — thin proxy to the active BroadcastManager.
 *
 * @example
 * // In a controller
 * Broadcast.send(new PostUpdated(post));
 * Broadcast.to('posts', 'PostDeleted', { id: post.id });
 *
 * // In tests
 * const fake = Broadcast.fake();
 * // ... trigger action ...
 * fake.assertBroadcast('PostUpdated', 'posts');
 * Broadcast.resetFake();
 */
export class Broadcast {
  private static _get(): BroadcastManager | BroadcastFake {
    if (_fake) return _fake;
    try {
      return currentApp().container.makeSync("broadcast");
    } catch {
      throw new BroadcastProviderNotRegisteredError();
    }
  }

  /**
   * Register a channel authorization callback. Call this in `routes/channels.ts`.
   *
   * Patterns use `[param]` placeholders (one channel segment each), passed to the callback
   * positionally after the authenticated user. Return a boolean for private channels, or a
   * member-data object for presence channels (`false`/`null` to deny).
   *
   * @example
   * // routes/channels.ts
   * Broadcast.channel("orders.[orderId]", async (user: User, orderId: string) => {
   *   return user.id === (await Order.findOrNew(orderId)).userId;
   * });
   *
   * Broadcast.channel("chat.[roomId]", (user: User, roomId: string) => {
   *   return user.canJoin(roomId) ? { id: user.id, name: user.name } : null;
   * });
   */
  static channel<User = unknown>(pattern: string, callback: ChannelCallback<User>): void {
    channelRegistry.register(pattern, callback);
  }

  /** Registered channel patterns (for inspection / `channel:list`). */
  static channels(): { pattern: string; paramNames: string[] }[] {
    return channelRegistry.all();
  }

  /**
   * Begin an anonymous broadcast (no event class) on a public channel.
   * @example Broadcast.on(`orders.${id}`).as("OrderPlaced").with(order).send();
   */
  static on(channel: string): AnonymousBroadcast {
    return new AnonymousBroadcast(channel);
  }

  /** Anonymous broadcast on a private channel (prefixes `private-`). */
  static private(channel: string): AnonymousBroadcast {
    return new AnonymousBroadcast(privateChannel(channel));
  }

  /** Anonymous broadcast on a presence channel (prefixes `presence-`). */
  static presence(channel: string): AnonymousBroadcast {
    return new AnonymousBroadcast(presenceChannel(channel));
  }

  /**
   * Broadcast an event to all channels declared in broadcastOn().
   * `opts.exceptSocketId` skips one connection (used by `broadcast(event).toOthers()`).
   */
  static send(event: BroadcastEvent, opts?: { exceptSocketId?: string }): void {
    Broadcast._get().send(event, opts);
  }

  /**
   * Broadcast a raw event to a specific channel.
   * @example
   * Broadcast.to('posts', 'PostViewed', { id: 1, viewedAt: new Date() });
   */
  static to(
    channel: string,
    eventName: string,
    data?: unknown,
    opts?: { exceptSocketId?: string },
  ): void {
    Broadcast._get().to(channel, eventName, data, opts);
  }

  /**
   * Return all members currently subscribed to a presence channel.
   * Only works with the real BroadcastManager (not the fake).
   */
  static getMembers(channel: string): PresenceMember[] {
    const inst = Broadcast._get();
    if (inst instanceof BroadcastFake) return [];
    return inst.getMembers(channel);
  }

  /**
   * Replace the real manager with a BroadcastFake for the duration of the test.
   * Call `Broadcast.resetFake()` in afterEach to restore.
   *
   * @returns the fake, for assertions
   */
  static fake(): BroadcastFake {
    _fake = new BroadcastFake();
    return _fake;
  }

  /** Remove the fake and restore container-backed resolution. */
  static resetFake(): void {
    _fake = null;
  }
}
