import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import { BroadcastMessage } from "./BroadcastMessage.ts";
import { optionalPeer } from "@zerotal/core/runtime";

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
    // @zerotal/broadcasting is an optional peer, loaded the first time a
    // notification goes out on this channel. Not installed throws
    // OptionalPeerMissingError with the install command; an installed package
    // that throws while loading is rethrown as itself, so nobody is sent to
    // install what they already have.
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
    const broadcasting: BroadcastApi = await import("@zerotal/broadcasting" as string).catch(
      optionalPeer("@zerotal/broadcasting", {
        feature: 'a notification with "broadcast" in its channels()',
      }),
    );

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
