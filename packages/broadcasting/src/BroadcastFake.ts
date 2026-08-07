import type { BroadcastEvent } from "./types.ts";

export interface RecordedBroadcast {
  channel: string;
  event: string;
  data: Record<string, unknown>;
}

/**
 * In-test fake that records broadcast calls without requiring a WS server.
 *
 * @example
 * const fake = Broadcast.fake();
 *
 * // ... controller action that calls Broadcast.send(new PostUpdated(post))
 *
 * fake.assertBroadcast('PostUpdated', 'posts');
 * fake.assertNothingBroadcast();
 */
export class BroadcastFake {
  private _broadcasts: RecordedBroadcast[] = [];

  to(
    channel: string,
    eventName: string,
    data: unknown = {},
    _opts?: { exceptSocketId?: string },
  ): void {
    this._broadcasts.push({ channel, event: eventName, data: data as Record<string, unknown> });
  }

  send(event: BroadcastEvent, opts?: { exceptSocketId?: string }): void {
    const channels = [event.broadcastOn()].flat();
    const name = event.broadcastAs?.() ?? event.constructor.name;
    const data = event.broadcastWith?.() ?? {};
    for (const ch of channels) {
      this.to(ch, name, data, opts);
    }
  }

  /** Return all recorded broadcasts. */
  recorded(): RecordedBroadcast[] {
    return [...this._broadcasts];
  }

  /** Reset recorded broadcasts. */
  reset(): void {
    this._broadcasts = [];
  }

  // ── Assertions ────────────────────────────────────────────────────────────

  /**
   * Assert that an event was broadcast on the given channel (and optionally with given data).
   *
   * @example
   * fake.assertBroadcast('PostUpdated', 'posts');
   * fake.assertBroadcast('PostUpdated', 'posts', { id: 1 });
   */
  assertBroadcast(eventName: string, channel?: string, data?: Record<string, unknown>): void {
    const match = this._broadcasts.find((b) => {
      if (b.event !== eventName) return false;
      if (channel && b.channel !== channel) return false;
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          if ((b.data as Record<string, unknown>)[k] !== v) return false;
        }
      }
      return true;
    });
    if (!match) {
      const desc = channel ? ` on channel "${channel}"` : "";
      throw new Error(
        `Expected event "${eventName}"${desc} to have been broadcast, but it was not.\n` +
          `Recorded: ${JSON.stringify(
            this._broadcasts.map((b) => `${b.event}@${b.channel}`),
            null,
            2,
          )}`,
      );
    }
  }

  /**
   * Assert that the given event was NOT broadcast.
   */
  assertNotBroadcast(eventName: string, channel?: string): void {
    const match = this._broadcasts.find((b) => {
      if (b.event !== eventName) return false;
      if (channel && b.channel !== channel) return false;
      return true;
    });
    if (match) {
      throw new Error(`Expected event "${eventName}" NOT to have been broadcast, but it was.`);
    }
  }

  /** Assert that no broadcasts were recorded. */
  assertNothingBroadcast(): void {
    if (this._broadcasts.length > 0) {
      throw new Error(
        `Expected nothing to be broadcast, but ${this._broadcasts.length} broadcast(s) were recorded:\n` +
          this._broadcasts.map((b) => `  ${b.event}@${b.channel}`).join("\n"),
      );
    }
  }

  /** Assert that exactly `count` broadcasts were recorded. */
  assertBroadcastCount(count: number): void {
    if (this._broadcasts.length !== count) {
      throw new Error(`Expected ${count} broadcast(s) but got ${this._broadcasts.length}.`);
    }
  }
}
