// ── Notifiable ────────────────────────────────────────────────────────────────
//
// Notifiable model mixin — compose it
// onto any model that should receive notifications (typically User):
//
//   import { Model } from "@zerotal/orm";
//   import { Notifiable } from "@zerotal/notifications";
//
//   export class User extends Model.using(Notifiable) {
//     @column() email!: string;
//   }
//
//   await user.notify(new OrderShipped(order));   // send now, across all channels
//   await user.notifyLater(new OrderShipped(order)); // queue for background delivery
//   const unread = await user.unreadNotifications();  // database-channel inbox
//   await user.markNotificationsAsRead();
//
// The model only needs an `id` (and `email`/`phone` for the mail/sms channels) to
// satisfy the Notifiable contract. These methods delegate to the same
// NotificationManager the `Notify` facade uses, so behaviour is identical — this is
// purely an ergonomic, object-oriented entry point.
//
// `Notifiable` is both the mixin (value) and the contract (type) — a function+interface
// merge — so `import { Notifiable }` composes and `import type { Notifiable }` annotates.

import { currentApp } from "@zerotal/core";
import type { Notifiable as NotifiableContract } from "./types.ts";
import type { Notification } from "./Notification.ts";
import type { NotificationManager } from "./NotificationManager.ts";
import type { InboxQuery, NotificationRecord } from "./DatabaseChannel.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
type Constructor<T = object> = new (...args: any[]) => T;

/** Resolve the live NotificationManager from the container (bound by NotificationProvider). */
function _manager(): NotificationManager {
  return currentApp().container.makeSync("notifications") as NotificationManager;
}

/**
 * The one cast this module makes: a mixin's `this` is typed by its generic base,
 * which cannot promise the `id`/`email` fields the Notifiable contract reads —
 * those come from the composing model's columns. The manager reads them at
 * delivery time, so a model composed without an `id` fails there, not here.
 */
function asNotifiable(model: object): Notifiable {
  return model as unknown as Notifiable;
}

export function Notifiable<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    /** Send a notification to this model now, across the notification's channels. */
    async notify(notification: Notification): Promise<void> {
      await _manager().send(asNotifiable(this), notification);
    }

    /** Queue a notification for background delivery via @zerotal/queue. */
    async notifyLater(notification: Notification): Promise<void> {
      await _manager().queue(asNotifiable(this), notification);
    }

    /** All stored (database-channel) notifications for this model, newest first. */
    async notifications(query?: InboxQuery): Promise<NotificationRecord[]> {
      return _manager().database.all(asNotifiable(this), query);
    }

    /** Unread stored notifications for this model, newest first. */
    async unreadNotifications(query?: InboxQuery): Promise<NotificationRecord[]> {
      return _manager().database.unread(asNotifiable(this), query);
    }

    /** How many unread notifications this model has — for a badge, without loading rows. */
    async unreadNotificationCount(): Promise<number> {
      return _manager().database.unreadCount(asNotifiable(this));
    }

    /** Mark all of this model's unread notifications as read. */
    async markNotificationsAsRead(): Promise<void> {
      await _manager().database.markAllAsRead(asNotifiable(this));
    }

    /** Delete every stored notification for this model. */
    async clearNotifications(): Promise<void> {
      await _manager().database.clear(asNotifiable(this));
    }
  };
}

/**
 * A model composed with the {@link Notifiable} mixin. Declared here so `Notifiable` is both a
 * value (the mixin) and a type (the contract) — it merges with the function above. Extends the
 * base notifiable contract, so instances pass anywhere a notifiable is expected.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty body is the point: it merges the name with the mixin function above
export interface Notifiable extends NotifiableContract {}
