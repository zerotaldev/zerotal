# @zerotal/notifications

> Multi-channel notifications — mail, database, broadcast, Slack, and SMS — from a single class.

Send the same notification across multiple delivery channels from one class: a `Notification` describes _what_ to send and which `channels()` to deliver on, while the `NotificationManager` routes it to each channel. Includes a `Notifiable` mixin for an object-oriented API and a `NotificationFake` for tests.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/notifications
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { NotificationProvider } from "@zerotal/notifications";
```

## Usage

Write a notification by extending `Notification`, declaring `channels()`, then implementing a `to*()` method per channel:

```ts
import { Notification, MailMessage } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";

export class OrderShippedNotification extends Notification {
  constructor(private order: Order) {
    super();
  }

  channels() {
    return ["mail", "database", "slack"];
  }

  toMail(_notifiable: Notifiable) {
    return new MailMessage()
      .subject(`Order #${this.order.id} shipped`)
      .line("Your order is on its way.")
      .action("Track package", `https://app.test/orders/${this.order.id}`);
  }

  toDatabase(_notifiable: Notifiable) {
    return { orderId: this.order.id, status: "shipped" };
  }

  toSlack(_notifiable: Notifiable) {
    return { text: `Order #${this.order.id} shipped` };
  }
}
```

The recipient is passed to `channels()`, so one notification can follow each person's preferences:

```ts
channels(user: Notifiable) {
  return user.wantsSms ? ["database", "sms"] : ["database", "mail"];
}
```

Send via the `Notify` facade or the `Notifiable` mixin:

```ts
import { Notify } from "@zerotal/notifications";

await Notify.send(user, new OrderShippedNotification(order));
await Notify.sendMany(admins, new LowStockNotification(product));
await Notify.route({ mail: "ops@acme.test" }).notify(new DeployFinished(build));
```

```ts
import { Notifiable } from "@zerotal/notifications";
import { AuthUser } from "@zerotal/auth";

export class User extends AuthUser.using(Notifiable) {}

await user.notify(new OrderShippedNotification(order)); // send now
await user.notifyLater(new OrderShippedNotification(order)); // queue
const unread = await user.unreadNotifications();
const badge = await user.unreadNotificationCount();
```

Every declared channel is attempted even if one fails, so a broken Slack webhook never costs the recipient their email. The failures are reported together afterwards as a `NotificationDispatchError`.

Real-time delivery: add `"broadcast"` to `channels()` and return a `BroadcastMessage` from `toBroadcast()` (requires `BroadcastProvider`).

Add a channel of your own with `extend()`:

```ts
const notifications = app.container.makeSync("notifications");
notifications.extend("discord", () => new DiscordChannel(config));
```

Testing with `NotificationFake`:

```ts
import { NotificationFake } from "@zerotal/notifications";

const notify = NotificationFake.install();
await triggerShipment(order);
notify.assertSentTo(user, OrderShippedNotification);
notify.assertSentOn(user, OrderShippedNotification, "mail");
notify.assertSentCount(1);
notify.restore();
```

## Console commands

- `bun zt notifications:prune --days 30` — delete stored notifications that have been read and are older than the threshold. Pass `--all` to include unread.
- `bun zt notifications:test you@example.com` — send one real email through the configured mail driver, to check a transport end to end.

## Exports

- `Notification` — base class for notifications; declare `channels()` and `to*()` methods.
- `Notify` — facade for `send` / `sendMany` / `queue` / `route` / `extend`.
- `Notifiable` — mixin adding `notify`, `notifyLater`, and database-inbox helpers to a model (also the recipient contract type).
- `NotificationManager` — the manager that routes notifications to channels.
- `NotificationFake` — in-memory test double with `assertSentTo` / `assertSentOn` / `assertQueued` / `assertSentTimes` / `assertSentCount` / `assertNothingSent`.
- `NotificationProvider` — service provider registering the manager.
- `NotificationConfig` / `validateNotificationConfig` — config factory and its boot-time checks.
- `NotificationRegistry` — registers a notification class for queue rebuilding when it lives outside `app/notifications/`.
- Channels: `MailChannel`, `DatabaseChannel`, `SlackChannel`, `SmsChannel`, `BroadcastChannel`, plus `BROADCAST_NOTIFICATION_EVENT`.
- `MailMessage` — fluent email builder with styled lines, a call-to-action, and attachments. `RichLine` builds mixed-style lines.
- `BroadcastMessage` — payload wrapper for the broadcast channel (supports `.onQueue()`).
- `OnDemandNotifiable` — recipient addressed directly rather than looked up.
- Mail drivers: `LogDriver`, `SmtpDriver`, `ResendDriver`, and the `MailDriver` contract.
- `SendNotificationJob` / `BroadcastNotificationJob` — queued jobs backing `notifyLater` and `onQueue`.
- `recentDeliveries` / `channelStats` — in-process delivery counters behind the admin console.
- Types: `Notifiable`, `NotificationChannel`, `NotificationConfigShape`, `SmsConfigShape`, `TwilioConfigShape`, `VonageConfigShape`, `NotificationRecord`, `InboxQuery`, `SlackMessage`, `SmsMessage`, `MailAttachment`, `TextStyle`.
- Typed error vocabulary re-exported from `./errors`.

## Documentation

- [Notifications](../../docs/notifications.md)
