import { Job, JobRegistry } from "@zerotal/queue";

/**
 * Delivers one broadcast notification from a queue.
 *
 * Dispatched only when a `BroadcastMessage` names a queue or connection via
 * `onQueue()` / `onConnection()`; an unrouted broadcast goes out inline, since
 * the whole point of the channel is immediacy. Its payload is the resolved wire
 * data, so it round-trips through a persistent driver without needing the
 * notification class.
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
    const { Broadcast } = (await import("@zerotal/broadcasting" as string)) as {
      Broadcast: { to(channel: string, event: string, data: unknown): void };
    };
    Broadcast.to(this._channel, this._event, this._data);
  }
}

JobRegistry.register(BroadcastNotificationJob);
