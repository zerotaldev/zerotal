import { NotificationContractError } from "./errors.ts";
import type { Notifiable } from "./types.ts";
import type { MailMessage } from "./messages/MailMessage.ts";
import type { SlackMessage } from "./SlackChannel.ts";
import type { SmsMessage } from "./SmsChannel.ts";
import type { BroadcastMessage } from "./BroadcastMessage.ts";

/**
 * Base class for all notifications.
 *
 * Extend this class, declare which channels() to use, then implement
 * the corresponding to*() method for each declared channel.
 *
 * Supported channels:
 *   'mail'     — implement toMail()     → returns a MailMessage
 *   'database' — implement toDatabase() → returns a plain object
 *   'slack'    — implement toSlack()    → returns a SlackMessage
 *   'sms'      — implement toSms()      → returns an SmsMessage
 *
 * @example
 * export class OrderShippedNotification extends Notification {
 *   constructor(private order: Order) { super(); }
 *
 *   channels() { return ['mail', 'slack', 'database']; }
 *
 *   toMail(notifiable: Notifiable): MailMessage {
 *     return new MailMessage()
 *       .subject(`Order #${this.order.id} shipped`)
 *       .line('Your order is on its way.')
 *       .action('Track', `https://app.test/orders/${this.order.id}`);
 *   }
 *
 *   toSlack(_notifiable: Notifiable): SlackMessage | Promise<SlackMessage> {
 *     return {
 *       webhookUrl: 'https://hooks.slack.com/services/...',
 *       text:       `Order #${this.order.id} was shipped!`,
 *     };
 *   }
 *
 *   toDatabase() {
 *     return { orderId: this.order.id, status: 'shipped' };
 *   }
 * }
 */
export abstract class Notification {
  /**
   * Declare which channels to deliver on: `'mail'`, `'database'`, `'slack'`,
   * `'sms'`, `'broadcast'`, or any channel registered with `extend()`.
   *
   * The recipient is passed in, so routing can follow their preferences.
   * Ignore the parameter when every recipient gets the same channels.
   *
   * @example
   * channels(user: Notifiable) {
   *   return user.wantsSms ? ["database", "sms"] : ["database", "mail"];
   * }
   */
  abstract channels(notifiable?: Notifiable): string[];

  toMail(_notifiable: Notifiable): MailMessage | Promise<MailMessage> {
    throw new NotificationContractError(this.constructor.name, "toMail", "mail");
  }

  toDatabase(_notifiable: Notifiable): Record<string, unknown> | Promise<Record<string, unknown>> {
    throw new NotificationContractError(this.constructor.name, "toDatabase", "database");
  }

  toSlack(_notifiable: Notifiable): SlackMessage | Promise<SlackMessage> {
    throw new NotificationContractError(this.constructor.name, "toSlack", "slack");
  }

  toSms(_notifiable: Notifiable): SmsMessage | Promise<SmsMessage> {
    throw new NotificationContractError(this.constructor.name, "toSms", "sms");
  }

  /**
   * The real-time representation for the 'broadcast' channel. Return a `BroadcastMessage`
   * (or a plain data object). Required when `channels()` includes `'broadcast'`.
   */
  toBroadcast(
    _notifiable: Notifiable,
  ):
    | BroadcastMessage
    | Record<string, unknown>
    | Promise<BroadcastMessage | Record<string, unknown>> {
    throw new NotificationContractError(this.constructor.name, "toBroadcast", "broadcast");
  }

  /** The wire `type` of a broadcast notification (lets clients distinguish kinds). Default: class name. */
  broadcastType(): string {
    return this.constructor.name;
  }

  /**
   * Serialize this notification's state so it can be queued.
   *
   * The default copies own enumerable fields, which covers the usual case of a
   * constructor assigning plain values. Override it when the notification holds
   * something JSON cannot carry — a model instance, a Date-keyed Map, a closure
   * — and pair the override with a matching `static fromPayload()`.
   *
   * @example
   * override payload() {
   *   return { orderId: this.order.id };
   * }
   *
   * static override async fromPayload(data: Record<string, unknown>) {
   *   return new OrderShipped(await Order.find(data.orderId as number));
   * }
   */
  payload(): Record<string, unknown> {
    return { ...this } as Record<string, unknown>;
  }
}
