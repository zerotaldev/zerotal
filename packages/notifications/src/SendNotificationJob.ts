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
 *
 * @internal
 */
export class SendNotificationJob extends Job {
  override readonly queue = "notifications";

  // The queue reads both from the job when it is dispatched and keeps them on the stored record,
  // so they are set here, from the notification, and default to the queue's own when it says
  // nothing. They were fixed at three attempts a second apart, with no way to change them.
  declare readonly maxAttempts: number;
  declare readonly retryDelay: number;

  private readonly _serialized: SerializedNotification | undefined;

  constructor(
    private readonly _notifiable?: Notifiable,
    private readonly _notification?: Notification,
    serialized?: SerializedNotification,
  ) {
    super();
    this._serialized = serialized;

    const retry = _notification
      ? { tries: _notification.tries, backoff: _notification.backoff }
      : serialized?.retry;
    const name = _notification?.constructor.name ?? serialized?.type ?? "Notification";
    if (retry?.tries !== undefined) this.maxAttempts = _tries(retry.tries, name);
    if (retry?.backoff !== undefined) this.retryDelay = _backoff(retry.backoff, name);
  }

  /** The wire form stored by persistent queue drivers. */
  override payload(): Record<string, unknown> {
    if (this._serialized) return { ...this._serialized };
    const notification = this._notification as Notification;
    const serialized = serializeNotification(this._notifiable as Notifiable, notification);
    if (notification.tries === undefined && notification.backoff === undefined) {
      return { ...serialized };
    }
    return { ...serialized, retry: { tries: notification.tries, backoff: notification.backoff } };
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

/** A whole number of attempts, at least one; anything else is refused where it was written. */
function _tries(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `${name}.tries must be a whole number of attempts, 1 or more. Got ${value}.`,
    );
  }
  return value;
}

/** Milliseconds between attempts, zero or more. */
function _backoff(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${name}.backoff must be a number of milliseconds, 0 or more. Got ${value}.`,
    );
  }
  return value;
}

JobRegistry.register(SendNotificationJob);
