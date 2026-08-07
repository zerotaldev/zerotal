import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import { BroadcastMessage } from "./BroadcastMessage.ts";
import { NotificationChannelUnavailableError } from "./errors.ts";

/** The wire event name used for every broadcast notification; the payload `type` distinguishes them. */
export const BROADCAST_NOTIFICATION_EVENT = "notification";

/**
 * Notification channel that pushes a notification to a connected client in real time via
 * `@zerotal/broadcasting`. Broadcasts on the notifiable's private channel
 * (`private-notifications.{id}` by default) with the event name `"notification"`; the payload
 * carries `{ ...data, id, type, readAt, createdAt }`.
 */
export class BroadcastChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    // Lazy import so @zerotal/notifications has no hard dependency on @zerotal/broadcasting.
    interface BroadcastApi {
      Broadcast: {
        to(channel: string, event: string, data: unknown): void;
        later?(
          channel: string,
          event: string,
          data: unknown,
          options?: { queue?: string; connection?: string },
        ): Promise<void> | void;
      };
    }
    let broadcasting: BroadcastApi;
    try {
      broadcasting = (await import("@zerotal/broadcasting" as string)) as BroadcastApi;
    } catch (error) {
      // Distinguish "not installed" from "installed but threw on import" — the
      // second reported as the first sends people to fix the wrong thing.
      const detail = error instanceof Error ? error.message : String(error);
      const missing = /cannot find (module|package)|module not found/i.test(detail);
      throw new NotificationChannelUnavailableError(
        missing
          ? "[Zerotal] Notifications broadcast channel requires @zerotal/broadcasting. " +
              "Register BroadcastProvider in bootstrap/providers.ts."
          : `[Zerotal] Notifications broadcast channel could not load @zerotal/broadcasting — ${detail}`,
      );
    }

    const result = await notification.toBroadcast(notifiable);
    const message = result instanceof BroadcastMessage ? result : new BroadcastMessage(result);

    const channel = this.channelFor(notifiable);
    const type = notification.broadcastType();
    const payload = {
      ...message.data,
      id: crypto.randomUUID(),
      type,
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    // A message routed with onQueue() is handed to the queue; anything else goes
    // out inline, which is the point of the channel.
    if (message.queue !== undefined) {
      const { BroadcastNotificationJob } = await import("./BroadcastNotificationJob.ts");
      const { Queue } = await import("@zerotal/queue");
      await Queue.dispatch(
        new BroadcastNotificationJob(channel, BROADCAST_NOTIFICATION_EVENT, payload, message.queue),
      );
      return;
    }

    broadcasting.Broadcast.to(channel, BROADCAST_NOTIFICATION_EVENT, payload);
  }

  /** The (prefixed) private channel a notifiable receives broadcast notifications on. */
  channelFor(notifiable: Notifiable): string {
    const custom = (
      notifiable as { receivesBroadcastNotificationsOn?(): string }
    ).receivesBroadcastNotificationsOn?.();
    const name = custom ?? `notifications.${notifiable.id}`;
    return name.startsWith("private-") || name.startsWith("presence-") ? name : `private-${name}`;
  }
}
