import { Application, currentApp } from "@zerotal/core";
import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import type { NotificationRecord } from "./DatabaseChannel.ts";
import type { OnDemandRoutes } from "./OnDemandNotifiable.ts";
import { OnDemandNotifiable } from "./OnDemandNotifiable.ts";

type Binding = unknown;

interface CapturedNotification {
  notifiable: Notifiable;
  notification: Notification;
  /** The channels the notification declared for this recipient. */
  channels: string[];
  /** Whether it went through `queue()` rather than `send()`. */
  queued: boolean;
}

/**
 * Drop-in replacement for NotificationManager that captures sent notifications
 * instead of delivering them. Install at the start of a test; restore after.
 *
 * @example
 * const notify = NotificationFake.install();
 *
 * await Notify.send(user, new OrderShippedNotification(order));
 *
 * notify.assertSentTo(user, OrderShippedNotification);
 * notify.assertSentOn(user, OrderShippedNotification, "mail");
 * notify.assertNothingSent(); // or assertSentCount(1)
 *
 * notify.restore(); // call in afterEach
 */
export class NotificationFake {
  private readonly _sent: CapturedNotification[] = [];
  private readonly _app: Application;
  private readonly _original: Binding;

  private constructor(app: Application, original: Binding) {
    this._app = app;
    this._original = original;
  }

  /** Replace the 'notifications' container binding with this fake. */
  static install(): NotificationFake {
    const app = currentApp();
    const original = app.container.registry.get("notifications");
    const fake = new NotificationFake(app, original);
    app.container.value("notifications", fake);
    return fake;
  }

  /** Restore the original 'notifications' binding. Call in afterEach. */
  restore(): void {
    if (this._original !== undefined) {
      this._app.container.registry.set("notifications", this._original as never);
    } else {
      this._app.container.registry.delete("notifications");
    }
  }

  // ── Notification manager interface ───────────────────────────────────────

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    this._capture(notifiable, notification, false);
  }

  async queue(notifiable: Notifiable, notification: Notification): Promise<void> {
    this._capture(notifiable, notification, true);
  }

  async sendMany(notifiables: Iterable<Notifiable>, notification: Notification): Promise<void> {
    for (const notifiable of notifiables) this._capture(notifiable, notification, false);
  }

  async queueMany(notifiables: Iterable<Notifiable>, notification: Notification): Promise<void> {
    for (const notifiable of notifiables) this._capture(notifiable, notification, true);
  }

  route(routes: OnDemandRoutes): {
    notify(notification: Notification): Promise<void>;
    notifyLater(notification: Notification): Promise<void>;
  } {
    const notifiable = new OnDemandNotifiable(routes);
    return {
      notify: async (notification) => this._capture(notifiable, notification, false),
      notifyLater: async (notification) => this._capture(notifiable, notification, true),
    };
  }

  /** Registering a custom channel on the fake is a no-op — nothing is delivered. */
  extend(): this {
    return this;
  }

  channels(): string[] {
    return ["mail", "database", "slack", "sms", "broadcast"];
  }

  /**
   * An inert stand-in for the real database channel.
   *
   * A faked send writes no rows, so the inbox is empty rather than absent — code
   * under test that reads `unreadNotifications()` keeps working instead of
   * throwing on a missing property. Assert on what was sent, not on this.
   */
  get database(): {
    all(): Promise<NotificationRecord[]>;
    unread(): Promise<NotificationRecord[]>;
    unreadCount(): Promise<number>;
    markAllAsRead(): Promise<void>;
    markAsRead(): Promise<void>;
    markAsUnread(): Promise<void>;
    delete(): Promise<void>;
    clear(): Promise<void>;
  } {
    return {
      all: async () => [],
      unread: async () => [],
      unreadCount: async () => 0,
      markAllAsRead: async () => undefined,
      markAsRead: async () => undefined,
      markAsUnread: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    };
  }

  private _capture(notifiable: Notifiable, notification: Notification, queued: boolean): void {
    let channels: string[] = [];
    try {
      channels = notification.channels(notifiable);
    } catch {
      /* a notification whose channels() throws is still worth recording */
    }
    this._sent.push({ notifiable, notification, channels, queued });
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  /** All captured notifications. */
  sent(): CapturedNotification[] {
    return [...this._sent];
  }

  /** Captured notifications for one recipient. */
  sentTo(notifiable: Notifiable): CapturedNotification[] {
    return this._sent.filter(({ notifiable: n }) => String(n.id) === String(notifiable.id));
  }

  /**
   * Assert that a notification was sent to the given notifiable.
   * Pass an optional filter callback to narrow the assertion.
   *
   * @example
   * notify.assertSentTo(user, OrderShippedNotification);
   * notify.assertSentTo(user, OrderShippedNotification, (n) => n.orderId === 42);
   */
  assertSentTo<T extends Notification>(
    notifiable: Notifiable,
    NotificationClass: new (...args: never[]) => T,
    callback?: (notification: T) => boolean,
  ): void {
    const matching = this._match(notifiable, NotificationClass, callback);
    if (matching.length === 0) {
      const hint = callback ? " matching the given filter" : "";
      throw new Error(
        `Expected ${NotificationClass.name} to have been sent to notifiable #${notifiable.id}${hint}, but it was not.${this._summary()}`,
      );
    }
  }

  /** Assert that a notification class was NOT sent to the given notifiable. */
  assertNotSentTo<T extends Notification>(
    notifiable: Notifiable,
    NotificationClass: new (...args: never[]) => T,
  ): void {
    const matching = this._match(notifiable, NotificationClass);
    if (matching.length > 0) {
      throw new Error(
        `Expected ${NotificationClass.name} NOT to have been sent to notifiable #${notifiable.id}, but it was (${matching.length}×).`,
      );
    }
  }

  /**
   * Assert a notification was sent to a recipient on a specific channel.
   *
   * @example
   * notify.assertSentOn(user, PasswordChanged, "mail");
   */
  assertSentOn<T extends Notification>(
    notifiable: Notifiable,
    NotificationClass: new (...args: never[]) => T,
    channel: string,
  ): void {
    const matching = this._match(notifiable, NotificationClass);
    if (matching.length === 0) {
      throw new Error(
        `Expected ${NotificationClass.name} to have been sent to notifiable #${notifiable.id} on '${channel}', but it was not sent at all.${this._summary()}`,
      );
    }
    if (!matching.some((m) => m.channels.includes(channel))) {
      const seen = [...new Set(matching.flatMap((m) => m.channels))];
      throw new Error(
        `Expected ${NotificationClass.name} to have been sent to notifiable #${notifiable.id} on '${channel}', ` +
          `but it declared: ${seen.join(", ") || "no channels"}.`,
      );
    }
  }

  /** Assert a notification was queued rather than sent immediately. */
  assertQueued<T extends Notification>(
    notifiable: Notifiable,
    NotificationClass: new (...args: never[]) => T,
  ): void {
    const matching = this._match(notifiable, NotificationClass);
    if (!matching.some((m) => m.queued)) {
      throw new Error(
        `Expected ${NotificationClass.name} to have been queued for notifiable #${notifiable.id}, ` +
          `but ${matching.length === 0 ? "it was not sent at all" : "it was sent immediately"}.${this._summary()}`,
      );
    }
  }

  /** Assert how many times a notification class was sent, to anyone. */
  assertSentTimes<T extends Notification>(
    NotificationClass: new (...args: never[]) => T,
    count: number,
  ): void {
    const actual = this._sent.filter(
      ({ notification }) => notification instanceof NotificationClass,
    ).length;
    if (actual !== count) {
      throw new Error(
        `Expected ${NotificationClass.name} to have been sent ${count}×, but it was sent ${actual}×.`,
      );
    }
  }

  /** Assert that zero notifications were sent. */
  assertNothingSent(): void {
    if (this._sent.length > 0) {
      const names = this._sent.map(({ notification }) => notification.constructor.name).join(", ");
      throw new Error(
        `Expected nothing to be sent, but ${this._sent.length} notification(s) were: ${names}.`,
      );
    }
  }

  /** Assert the exact total number of notifications sent. */
  assertSentCount(count: number): void {
    if (this._sent.length !== count) {
      throw new Error(
        `Expected ${count} notification(s) to be sent, but ${this._sent.length} were.${this._summary()}`,
      );
    }
  }

  private _match<T extends Notification>(
    notifiable: Notifiable,
    NotificationClass: new (...args: never[]) => T,
    callback?: (notification: T) => boolean,
  ): CapturedNotification[] {
    return this._sent.filter(
      ({ notifiable: n, notification }) =>
        String(n.id) === String(notifiable.id) &&
        notification instanceof NotificationClass &&
        (callback === undefined || callback(notification as T)),
    );
  }

  /** What was actually captured — the first thing you want when an assertion fails. */
  private _summary(): string {
    if (this._sent.length === 0) return " Nothing was sent.";
    const lines = this._sent.map(
      ({ notification, notifiable, channels, queued }) =>
        `${notification.constructor.name} → #${notifiable.id} [${channels.join(", ") || "no channels"}]${queued ? " (queued)" : ""}`,
    );
    return ` Sent: ${lines.join("; ")}.`;
  }
}
