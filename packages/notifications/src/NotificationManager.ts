import type { Notifiable, NotificationChannel, NotificationConfigShape } from "./types.ts";
import {
  NotificationChannelNotConfiguredError,
  NotificationDispatchError,
  UnknownNotificationChannelError,
} from "./errors.ts";
import type { Notification } from "./Notification.ts";
import { MailChannel } from "./MailChannel.ts";
import { DatabaseChannel } from "./DatabaseChannel.ts";
import { SlackChannel } from "./SlackChannel.ts";
import { SmsChannel } from "./SmsChannel.ts";
import { BroadcastChannel } from "./BroadcastChannel.ts";
import { OnDemandNotifiable, type OnDemandRoutes } from "./OnDemandNotifiable.ts";
import { _getConnection } from "@zerotal/orm";
import { FrameworkEvents } from "@zerotal/core";
import { NotificationSent, MessageQueued } from "./events.ts";

/** A channel factory, resolved once on first use. */
type ChannelResolver = () => NotificationChannel;

export class NotificationManager {
  /** Channel name → resolver. Built-ins are seeded here; `extend()` adds to it. */
  private readonly _resolvers = new Map<string, ChannelResolver>();
  /** Resolved channel instances, memoized per name. */
  private readonly _channels = new Map<string, NotificationChannel>();
  /**
   * The database channel, built on first use rather than at construction.
   *
   * It used to be built in the constructor, which meant every app that registered
   * this provider opened a `DatabaseChannel` against `database.table` — default
   * `notifications` — whether or not any notification ever routed there. `notifications`
   * is a very ordinary name for a table an app already owns, and one app's is a
   * completely different shape: `household_id`, `user_id`, `title`, `body`,
   * `action_url`, with an in-app inbox reading it. The only thing standing between
   * the framework's channel and a wrong-shaped insert into that inbox was that no
   * notification's `channels()` happened to return `"database"`. A convention holding
   * back data corruption is a convention that will lose.
   *
   * Building it lazily does not make the collision safe — `notificationsTableCheck`
   * is what reports that — but it means an app that never uses the channel never
   * touches the table, and it stops the manager resolving a database connection at
   * construction time.
   */
  private _dbChannel: DatabaseChannel | undefined;

  constructor(private readonly config: NotificationConfigShape) {
    this._resolvers.set("mail", () => new MailChannel(config.mail));
    this._resolvers.set("database", () => this.database);
    this._resolvers.set("broadcast", () => new BroadcastChannel());

    this._resolvers.set("slack", () => {
      if (config.slack === undefined) {
        throw new NotificationChannelNotConfiguredError(
          "slack",
          'Add slack: { webhook: "..." } to config/notifications.ts.',
        );
      }
      return new SlackChannel(config.slack);
    });

    this._resolvers.set("sms", () => {
      if (config.sms === undefined) {
        throw new NotificationChannelNotConfiguredError(
          "sms",
          'Add sms: { driver: "twilio", twilio: { ... } } to config/notifications.ts.',
        );
      }
      return new SmsChannel(config.sms);
    });
  }

  /**
   * Register a custom delivery channel, or replace a built-in one.
   *
   * The factory runs once, the first time the channel is used, so a channel
   * nobody sends on costs nothing.
   *
   * @example
   * // in a service provider's onBooted()
   * const notify = app.container.makeSync("notifications");
   * notify.extend("discord", () => new DiscordChannel(config));
   *
   * // then, in a notification
   * channels() { return ["discord"]; }
   * toDiscord() { return { content: "Deploy finished" }; }
   */
  extend(channel: string, factory: ChannelResolver): this {
    this._resolvers.set(channel, factory);
    this._channels.delete(channel);
    return this;
  }

  /** Every registered channel name, built-in and custom. */
  channels(): string[] {
    return [...this._resolvers.keys()];
  }

  /**
   * Send a notification via all declared channels immediately.
   *
   * Every channel is attempted even if an earlier one fails — a Slack webhook
   * returning 500 must not cost the recipient the email and the stored row that
   * were declared alongside it. If any channel failed, the failures are reported
   * together as a {@link NotificationDispatchError} once the rest are delivered.
   *
   * @throws {NotificationDispatchError} when one or more channels failed.
   *
   * @example
   * await Notify.send(user, new OrderShippedNotification(order));
   */
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const className = notification.constructor?.name ?? "Notification";
    const recipient = NotificationManager._notifiableLabel(notifiable);

    const failures: Array<{ channel: string; error: Error }> = [];
    const delivered: string[] = [];

    for (const channel of notification.channels(notifiable)) {
      // Per-channel delivery telemetry — one NotificationSent event per channel,
      // feeding the monitor's Notifications feed (distinct from the Mail log). This
      // single point also covers queued sends, which route back through send().
      const startedAt = performance.now();
      try {
        await this._dispatch(channel, notifiable, notification);
        delivered.push(channel);
        FrameworkEvents.emit(
          new NotificationSent(className, channel, recipient, true, performance.now() - startedAt),
        );
      } catch (error) {
        failures.push({
          channel,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        FrameworkEvents.emit(
          new NotificationSent(
            className,
            channel,
            recipient,
            false,
            performance.now() - startedAt,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    if (failures.length > 0) {
      // A single failing channel keeps its own error type, so `catch (e) { if (e
      // instanceof NotificationDeliveryError) }` still works for the common case.
      if (failures.length === 1 && delivered.length === 0) throw failures[0]!.error;
      throw new NotificationDispatchError(className, failures, delivered);
    }
  }

  /**
   * Send one notification to many recipients.
   *
   * Recipients are independent: one failing does not stop the rest, and the
   * errors are reported together at the end.
   *
   * @throws {NotificationDispatchError} when one or more recipients failed.
   *
   * @example
   * await Notify.sendMany(admins, new LowStockNotification(product));
   */
  async sendMany(notifiables: Iterable<Notifiable>, notification: Notification): Promise<void> {
    const failures: Array<{ channel: string; error: Error }> = [];
    let delivered = 0;

    for (const notifiable of notifiables) {
      try {
        await this.send(notifiable, notification);
        delivered++;
      } catch (error) {
        failures.push({
          channel: `recipient ${NotificationManager._notifiableLabel(notifiable)}`,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    if (failures.length > 0) {
      throw new NotificationDispatchError(
        notification.constructor?.name ?? "Notification",
        failures,
        Array.from({ length: delivered }, (_, i) => `recipient ${i + 1}`),
      );
    }
  }

  /** Queue one notification for many recipients. */
  async queueMany(notifiables: Iterable<Notifiable>, notification: Notification): Promise<void> {
    for (const notifiable of notifiables) {
      await this.queue(notifiable, notification);
    }
  }

  /**
   * Notify a destination that has no model behind it — a bare email address,
   * phone number, or Slack webhook.
   *
   * @example
   * await Notify.route({ mail: "ops@acme.test" }).notify(new DeployFinished(build));
   * await Notify.route({ sms: "+15551234567", mail: "on-call@acme.test" })
   *   .notifyLater(new PagerAlert(incident));
   */
  route(routes: OnDemandRoutes): {
    notify(notification: Notification): Promise<void>;
    notifyLater(notification: Notification): Promise<void>;
  } {
    const notifiable = new OnDemandNotifiable(routes);
    return {
      notify: (notification) => this.send(notifiable, notification),
      notifyLater: (notification) => this.queue(notifiable, notification),
    };
  }

  /** A stable recipient label: email when present, else the id. */
  private static _notifiableLabel(n: Notifiable): string {
    return n.email ?? String(n.id);
  }

  /**
   * Queue the notification for background delivery via @zerotal/queue.
   *
   * @example
   * await Notify.queue(user, new OrderShippedNotification(order));
   */
  async queue(notifiable: Notifiable, notification: Notification): Promise<void> {
    // If this notification mails, log it as "queued" now — the Mail tab shows the
    // deferred message immediately, before SendNotificationJob delivers it (at which
    // point MessageSent flips it to "sent"). Telemetry must never block the queue.
    if (notification.channels(notifiable).includes("mail")) {
      try {
        const message = await notification.toMail(notifiable);
        const to = notifiable.routeNotificationFor?.("mail") ?? notifiable.email;
        const fallbackTo = to
          ? [{ address: to, ...(notifiable.name ? { name: notifiable.name } : {}) }]
          : [];
        const payload = message.toPayload(this.config.mail.from, fallbackTo);
        FrameworkEvents.emit(
          new MessageQueued(
            notification.constructor?.name ?? "Notification",
            payload.to.map((a) => a.address),
            payload.subject,
            "notifications",
          ),
        );
      } catch {
        /* never block queuing on telemetry */
      }
    }
    const { SendNotificationJob } = await import("./SendNotificationJob.ts");
    const { Queue } = await import("@zerotal/queue");
    await Queue.dispatch(new SendNotificationJob(notifiable, notification));
  }

  /** Expose the database channel for direct queries (unread, markAsRead). */
  get database(): DatabaseChannel {
    this._dbChannel ??= new DatabaseChannel(this.config.database.table, _getConnection());
    return this._dbChannel;
  }

  private async _dispatch(
    channel: string,
    notifiable: Notifiable,
    notification: Notification,
  ): Promise<void> {
    await this._resolveChannel(channel).send(notifiable, notification);
  }

  /** Resolve a channel by name, constructing it on first use. */
  private _resolveChannel(channel: string): NotificationChannel {
    const existing = this._channels.get(channel);
    if (existing) return existing;

    const resolver = this._resolvers.get(channel);
    if (!resolver) {
      throw new UnknownNotificationChannelError(channel, [...this._resolvers.keys()]);
    }

    const instance = resolver();
    this._channels.set(channel, instance);
    return instance;
  }
}
