import { Job, JobRegistry } from "@zerotal/queue";
import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import type { NotificationManager } from "./NotificationManager.ts";
import {
  hydrateNotifiable,
  hydrateNotification,
  serializeNotification,
  type SerializedNotification,
} from "./serialization.ts";

/**
 * Background job that sends a queued Notification. Dispatched by `Notify.queue()`
 * and `notifyLater()`.
 *
 * The job carries the notification in one of two states. Dispatched in-process it
 * holds the live objects and uses them directly. Restored from a persistent driver
 * (SQLite/Redis) it holds only the serialized snapshot written by `payload()`, and
 * rebuilds both sides in `handle()` — asynchronously, because resolving a
 * notification class may require importing `app/notifications/`.
 */
export class SendNotificationJob extends Job {
  override readonly queue = "notifications";

  private readonly _serialized: SerializedNotification | undefined;

  constructor(
    private readonly _notifiable?: Notifiable,
    private readonly _notification?: Notification,
    serialized?: SerializedNotification,
  ) {
    super();
    this._serialized = serialized;
  }

  /** The wire form stored by persistent queue drivers. */
  override payload(): Record<string, unknown> {
    if (this._serialized) return { ...this._serialized };
    return {
      ...serializeNotification(this._notifiable as Notifiable, this._notification as Notification),
    };
  }

  /** Rebuild the job from a stored payload. Called by the queue on the worker side. */
  static fromPayload(data: Record<string, unknown>): SendNotificationJob {
    return new SendNotificationJob(undefined, undefined, data as unknown as SerializedNotification);
  }

  async handle(): Promise<void> {
    const { currentApp } = await import("@zerotal/core");
    const manager = currentApp().container.makeSync("notifications") as NotificationManager;

    const [notifiable, notification] = await this._resolve();
    await manager.send(notifiable, notification);
  }

  /** The live pair when dispatched in-process; the rebuilt pair when restored. */
  private async _resolve(): Promise<[Notifiable, Notification]> {
    if (this._notifiable && this._notification) {
      return [this._notifiable, this._notification];
    }
    const s = this._serialized as SerializedNotification;
    return [hydrateNotifiable(s.notifiable), await hydrateNotification(s.type, s.data)];
  }
}

JobRegistry.register(SendNotificationJob);
