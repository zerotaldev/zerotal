import { Job, JobRegistry } from "@zerotal/queue";
import { optionalPeer } from "@zerotal/core/runtime";

/**
 * Delivers one broadcast notification from a queue.
 *
 * Dispatched only when a `BroadcastMessage` names a queue or connection via
 * `onQueue()` / `onConnection()`; an unrouted broadcast goes out inline, since
 * the whole point of the channel is immediacy. Its payload is the resolved wire
 * data, so it round-trips through a persistent driver without needing the
 * notification class.
 *
 * @internal
 */
export class BroadcastNotificationJob extends Job {
  override readonly queue: string;

  constructor(
    private readonly _channel: string = "",
    private readonly _event: string = "",
    private readonly _data: Record<string, unknown> = {},
    queue = "broadcast",
  ) {
    super();
    this.queue = queue;
  }

  override payload(): Record<string, unknown> {
    return {
      channel: this._channel,
      event: this._event,
      data: this._data,
      queue: this.queue,
    };
  }

  static fromPayload(data: Record<string, unknown>): BroadcastNotificationJob {
    return new BroadcastNotificationJob(
      data["channel"] as string,
      data["event"] as string,
      data["data"] as Record<string, unknown>,
      (data["queue"] as string) ?? "broadcast",
    );
  }

  async handle(): Promise<void> {
    // The worker is a process of its own, so it needs @zerotal/broadcasting
    // installed as much as the web process that queued the job.
    const broadcasting: {
      Broadcast: { to(channel: string, event: string, data: unknown): void };
    } = await import("@zerotal/broadcasting" as string).catch(
      optionalPeer("@zerotal/broadcasting", { feature: "a queued broadcast notification" }),
    );
    broadcasting.Broadcast.to(this._channel, this._event, this._data);
  }
}

JobRegistry.register(BroadcastNotificationJob);
