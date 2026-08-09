---
title: Notifications
description: Send one notification across mail, database, Slack, SMS, and real-time broadcast channels from a single class.
---

# Notifications

`@zerotal/notifications` lets you describe a notification once and deliver it
over many channels — mail, database, Slack, SMS, or a real-time broadcast. A
notification class says _what_ to send and on which channels; the manager handles
routing each channel to its driver.

## Getting Started

```bash
# in your project root
bun add @zerotal/notifications
```

The mail, database, Slack, SMS, and broadcast channels are all built into this
package — no extra channel packages to install.

## Register the provider

Add `NotificationProvider` to the providers array in `bootstrap/providers.ts`.
The database channel reads from your ORM connection, so register it after
`DatabaseProvider`:

```ts
// bootstrap/providers.ts
import { DatabaseProvider } from "@zerotal/orm";
import { NotificationProvider } from "@zerotal/notifications";

const providers = [
  // …your other providers
  DatabaseProvider,
  NotificationProvider,
];

export default providers;
```

Registering the provider switches on the following:

- `onRegister` — binds `NotificationManager` as a lazy singleton under the
  `"notifications"` container key, built from `config/notifications.ts`.
- `onBooted` — eagerly resolves that binding so the manager (and its database
  table) is ready before the first request.

## Configuration

Create `config/notifications.ts` with the `NotificationConfig()` helper — it
merges your overrides over sensible defaults, so you only set the keys you need:

```ts
// config/notifications.ts
import { NotificationConfig } from "@zerotal/notifications";
import { env } from "zerotal";

export default NotificationConfig({
  database: {
    table: "notifications", // table for stored notifications
  },

  // mail channel works out of the box on the 'log' driver; switch to smtp/resend here
  mail: {
    driver: "log",
    from: { address: "hello@example.com", name: "Zerotal App" },
  },

  // Optional — global Slack webhook fallback (per-notification toSlack() can override):
  slack: {
    webhook: env("SLACK_WEBHOOK_URL", ""),
  },

  // Optional — required only for the 'sms' channel:
  sms: {
    driver: "twilio", // 'twilio' | 'vonage'
    twilio: {
      accountSid: env("TWILIO_ACCOUNT_SID", ""),
      authToken: env("TWILIO_AUTH_TOKEN", ""),
      from: env("TWILIO_FROM", ""),
    },
  },
});
```

| Field            | Required | Default                           | Description                                                                 |
| ---------------- | -------- | --------------------------------- | --------------------------------------------------------------------------- |
| `database.table` | no       | `"notifications"`                 | Table where database-channel notifications are stored (auto-created).       |
| `mail.driver`    | no       | `"log"`                           | Mail transport: `"log"` (prints to console), `"smtp"`, or `"resend"`.       |
| `mail.from`      | no       | `hello@example.com` / Zerotal App | Default sender, used unless a `MailMessage` overrides it with `from()`.     |
| `mail.smtp`      | no       | localhost:1025                    | SMTP host/port/credentials, used when `driver` is `"smtp"`.                 |
| `mail.resend`    | no       | `{ apiKey: "" }`                  | Resend API key, used when `driver` is `"resend"`.                           |
| `slack`          | no       | unset                             | Global Slack webhook fallback. Include only if you use the `slack` channel. |
| `sms`            | no       | unset                             | SMS driver (`"twilio"` or `"vonage"`) and credentials. Required for `sms`.  |

> **Note** — The `slack` and `sms` keys are optional. If a notification declares
> a channel whose config is missing, the manager throws a
> `NotificationChannelNotConfiguredError` at send time.

`NotificationConfig()` checks the result before returning it, so combinations
that could only fail at send time fail at boot instead: a `resend` driver with no
API key, an `smtp` driver with no host, a username without a password, a `from`
that is not an address, or an SMS driver missing its credential block. Each
raises a `NotificationConfigError` naming the key to fix.

### SMTP transport security

The `secure` flag chooses how the connection is protected, and the driver refuses
combinations that would leak credentials:

- `secure: true` — TLS from the first byte, the usual choice for port 465.
- `secure: false` — connects in the clear and upgrades via STARTTLS when the
  server offers it, the usual choice for port 587.
- `secure: false` against a server with no STARTTLS — stays plaintext. If
  credentials are configured, the send is refused rather than sent in the open,
  because SMTP authentication is base64-encoded, not encrypted.

That last case is the one worth knowing about: a local relay like Mailpit needs
no credentials, so it just works. If you genuinely want to authenticate against a
trusted relay over plaintext, set `mail.smtp.allowInsecureAuth: true` to say so
deliberately.

| Field                     | Default   | Description                                            |
| ------------------------- | --------- | ------------------------------------------------------ |
| `smtp.allowInsecureAuth`  | `false`   | Permit authentication over an unencrypted connection.  |
| `smtp.rejectUnauthorized` | `true`    | Reject servers presenting an untrusted certificate.    |
| `smtp.timeoutMs`          | `30000`   | How long to wait for any single reply from the server. |
| `smtp.clientName`         | `zerotal` | The name sent in the EHLO greeting.                    |

To check a transport end to end, `bun zt notifications:test you@example.com`
sends one real message and prints whatever the server said.

## Writing a notification

Extend `Notification`, declare `channels()`, then implement a `to*()` method for
each declared channel:

```ts
// app/notifications/OrderShippedNotification.ts
import { Notification, MailMessage } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";

export class OrderShippedNotification extends Notification {
  constructor(private order: Order) {
    super();
  }

  // Which channels to deliver on
  channels() {
    return ["mail", "database", "slack"];
  }

  // mail channel — return a MailMessage
  toMail(notifiable: Notifiable) {
    return new MailMessage()
      .subject(`Order #${this.order.id} shipped`)
      .line("Your order is on its way.")
      .action("Track package", `https://app.test/orders/${this.order.id}`);
  }

  // database channel — stored in the notifications table
  toDatabase(_notifiable: Notifiable) {
    return {
      orderId: this.order.id,
      status: "shipped",
      message: `Order #${this.order.id} has been shipped.`,
    };
  }

  // slack channel
  toSlack(_notifiable: Notifiable) {
    return {
      webhookUrl: "https://hooks.slack.com/services/...", // optional if a global webhook is configured
      text: `Order #${this.order.id} shipped to ${this.order.customerName}`,
    };
  }
}
```

> **Warning** — A `to*()` method you don't implement throws a
> `NotificationContractError` if its channel is declared in `channels()`. Keep
> the two in sync.

### Routing per recipient

`channels()` receives the recipient, so a single notification can respect each
person's preferences instead of forcing every recipient down the same path:

```ts
// app/notifications/OrderShippedNotification.ts
channels(user: Notifiable) {
  // Everyone gets the inbox copy; how they're alerted is their choice.
  return user.prefersSms ? ["database", "sms"] : ["database", "mail"];
}
```

Ignore the parameter when every recipient gets the same channels — that is the
common case, and `channels()` with no arguments stays valid.

A recipient can also redirect an individual channel without any notification
knowing about it, by implementing `routeNotificationFor`:

```ts
// app/models/User.ts
routeNotificationFor(channel: string) {
  // Invoices go to the billing contact; everything else to the usual address.
  return channel === "mail" ? this.billingEmail : undefined;
}
```

Return `undefined` to fall back to the default for that channel — `email` for
mail, `phone` for SMS, the configured webhook for Slack.

### When a channel fails

Channels are independent, so one failing does not cancel the others: every
declared channel is attempted, and the failures are collected and thrown together
afterwards as a `NotificationDispatchError`. A Slack webhook returning a 500 does
not cost the recipient the email and the stored row that were declared alongside
it.

```ts
// in a controller or service
try {
  await Notify.send(user, new OrderShippedNotification(order));
} catch (error) {
  if (error instanceof NotificationDispatchError) {
    error.delivered; // ["mail", "database"] — these did arrive
    error.failures; // [{ channel: "slack", error }] — this did not
  }
}
```

When a notification declares exactly one channel and it fails, that channel's own
error is thrown unwrapped, so a `catch` narrowing on `NotificationDeliveryError`
still reads naturally.

## The Notifiable interface

The entity receiving the notification must satisfy `Notifiable`:

```ts
// from @zerotal/notifications
interface Notifiable {
  id: number | string;
  email?: string; // default recipient for the 'mail' channel
  name?: string;
  phone?: string; // default recipient for the 'sms' channel (E.164 format)
  receivesBroadcastNotificationsOn?(): string; // override the broadcast channel
  routeNotificationFor?(channel: string): string | undefined; // per-channel override
}
```

Your `User` model already satisfies this if it has `id` and `email` fields. To
get the object-oriented API (`user.notify(...)`, inbox helpers), compose the
[`Notifiable` mixin](#via-the-notifiable-mixin).

## Sending notifications

There are three entry points — all delegate to the same `NotificationManager`,
so behaviour is identical.

### Which should I use?

- **`Notifiable` mixin** — the ergonomic default when the recipient is a
  model. Gives you `user.notify(...)` plus the database-inbox helpers.
- **`Notify` facade** — when you have a notifiable that isn't a mixin-composed
  model, or you prefer a static call site.
- **`NotificationManager` directly** — when you've resolved the manager from the
  container yourself (e.g. in a service with the container in hand).

### Via the Notifiable mixin

Compose `Notifiable(Base)` onto your notifiable model — the
`Notifiable` mixin. It adds `notify` / `notifyLater` plus
database-inbox helpers:

```ts
// app/models/User.ts
import { AuthUser } from "@zerotal/auth";
import { column, table } from "@zerotal/orm";
import { Notifiable } from "@zerotal/notifications";

@table("users")
export class User extends AuthUser.using(Notifiable) {
  @column() email!: string;
}
```

```ts
// in a controller or service
await user.notify(new OrderShippedNotification(order)); // send now
await user.notifyLater(new OrderShippedNotification(order)); // queue for background

const unread = await user.unreadNotifications(); // database-channel inbox
const all = await user.notifications();
await user.markNotificationsAsRead();
```

### Via the Notify facade

```ts
// in a controller or service
import { Notify } from "@zerotal/notifications";

await Notify.send(user, new OrderShippedNotification(order)); // send now
await Notify.queue(user, new OrderShippedNotification(order)); // queue for background
```

### To many recipients at once

`sendMany` and `queueMany` take any iterable of notifiables. Recipients are
independent: one failing does not stop the rest, and the errors are reported
together at the end.

```ts
// in a controller or service
const admins = await User.where("role", "admin").get();
await Notify.sendMany(admins, new LowStockNotification(product));
```

### To an address with no model behind it

Some notifications go to a destination rather than a user — an on-call address, a
webhook, a number typed into a form. `route()` takes the destinations directly:

```ts
// in a controller or service
await Notify.route({ mail: "ops@acme.test" }).notify(new DeployFinished(build));

await Notify.route({
  sms: "+15551234567",
  slack: "https://hooks.slack.com/services/…",
}).notifyLater(new PagerAlert(incident));
```

Each key routes one channel, and `notifyLater` queues exactly as it does for a
model. The `database` channel is the one to avoid here: rows it writes are keyed
to a generated id that nothing can query back, so an on-demand notification
normally declares only transport channels.

### Via the NotificationManager directly

```ts
// in a service
import { NotificationManager } from "@zerotal/notifications";
import { Application } from "zerotal";

const manager = await currentApp().container.make(NotificationManager);
await manager.send(user, new OrderShippedNotification(order));
```

## Channels

### mail

Implement `toMail(notifiable)` returning a `MailMessage`. The recipient defaults
to the notifiable's `email`, so you rarely set `to()`. The mail channel is
built-in and works on the `log` driver out of the box; switch to `smtp` or
`resend` in `config/notifications.ts`.

```ts
// in a Notification
import { MailMessage } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";

toMail(n: Notifiable): MailMessage {
  return new MailMessage()
    .subject("Your order shipped")
    .greeting(`Hi ${n.name ?? "there"},`, { bold: true })
    .line("Your order is on its way.")
    .action("Track package", "https://app.test/orders/123");
}
```

Attach files with `attach()` when you already have the bytes, or `attachFile()`
to read one from disk. `embed()` places an image in the body rather than listing
it as a download — reference it from your HTML as `cid:the-id`:

```ts
// in a Notification
async toMail(_n: Notifiable): Promise<MailMessage> {
  return (await new MailMessage()
    .subject("Your invoice")
    .line("This month's invoice is attached.")
    .attachFile("./storage/invoices/2026-07.pdf"))
    .embed("logo", { filename: "logo.png", content: logoBytes, contentType: "image/png" });
}
```

### database

Implement `toDatabase(notifiable)` returning a plain object. The notification is
stored in the configured table (`notifications` by default), which is
auto-created on first use:

| Column            | Value                                   |
| ----------------- | --------------------------------------- |
| `id`              | UUID                                    |
| `notifiable_type` | recipient model name (currently `User`) |
| `notifiable_id`   | stringified recipient id                |
| `type`            | notification class name                 |
| `data`            | JSON payload from `toDatabase()`        |
| `read_at`         | `null` until marked read                |
| `created_at`      | ISO timestamp                           |

`notifiable_type` is the recipient's own class name, and every read is scoped by
the type and the id together — ids are only unique within a model, so a `User#1`
and a `Team#1` keep separate inboxes.

Read and mark stored notifications through the [mixin helpers](#via-the-notifiable-mixin)
(`notifications()`, `unreadNotifications()`, `markNotificationsAsRead()`).

Inbox reads return the 100 most recent rows unless told otherwise. Pass a limit
and offset to page, or `limit: 0` for everything:

```ts
// in a controller
const page = await user.notifications({ limit: 20, offset: 40 });
const badge = await user.unreadNotificationCount(); // counts without loading rows
```

Nothing is deleted automatically, so a long-lived app accumulates rows
indefinitely. `bun zt notifications:prune --days 30` deletes read notifications
past an age threshold; add `--all` to include unread ones. Schedule it.

### slack

Implement `toSlack(notifiable)` returning a `SlackMessage`:

```ts
// in a Notification
import type { SlackMessage } from "@zerotal/notifications";

toSlack(_notifiable: Notifiable): SlackMessage {
  return {
    text: `New signup: ${user.email}`,
    // blocks: [...]  // optional Block Kit blocks for rich formatting
  };
}
```

The webhook URL is resolved from the most specific source available: the
message's own `webhookUrl`, then the recipient's `routeNotificationFor("slack")`,
then `slack.webhook` in `config/notifications.ts`. Set the global one and most
notifications need only supply text. When none of the three yields a URL, the
channel raises a `NotificationChannelNotConfiguredError` naming the notification.

### sms

Implement `toSms(notifiable)` returning an `SmsMessage`. Supported drivers:
`twilio` and `vonage`.

```ts
// in a Notification
import type { SmsMessage } from "@zerotal/notifications";

toSms(_notifiable: Notifiable): SmsMessage {
  return { body: `Your verification code is ${this.code}.` };
}
```

The recipient defaults to the notifiable's `phone`, exactly as mail defaults to
`email`, so `to` is only needed when sending somewhere else. A notifiable with no
phone and no `to` raises an error naming the notification rather than silently
sending nothing.

### broadcast

Push a notification to a connected client in real time via
[`@zerotal/broadcasting`](/docs/broadcasting). Implement `toBroadcast(notifiable)`
returning a `BroadcastMessage` (or a plain data object), and optionally
`broadcastType()` to set the wire `type`:

```ts
// app/notifications/InvoicePaid.ts
import { Notification, BroadcastMessage } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";

export class InvoicePaid extends Notification {
  constructor(private invoice: Invoice) {
    super();
  }

  channels() {
    return ["database", "broadcast"];
  }

  toBroadcast(_notifiable: Notifiable): BroadcastMessage {
    return new BroadcastMessage({ invoiceId: this.invoice.id, amount: this.invoice.amount });
  }

  broadcastType() {
    return "invoice.paid"; // default: the class name
  }
}
```

The broadcast channel works like this:

- **Channel.** Broadcasts on the notifiable's private channel —
  `private-notifications.{id}` by default. Override per notifiable with
  `receivesBroadcastNotificationsOn(): string`:

  ```ts
  // app/models/User.ts
  class User extends Model {
    receivesBroadcastNotificationsOn() {
      return `users.${this.id}`;
    }
  }
  ```

- **Event + payload.** The wire event name is `"notification"`; the payload is
  your data merged with `{ id, type, readAt: null, createdAt }`, so the client
  can render it like a stored notification.
- **Authorize** the per-user channel in `routes/channels.ts`:

  ```ts
  // routes/channels.ts
  Broadcast.channel("notifications.[id]", (user, id) => String(user.id) === id);
  ```

- **Client** (any Pusher-compatible client):

  ```ts
  // in your frontend
  Echo.private(`notifications.${userId}`).listen("notification", (n) => {
    console.log(n.type, n);
  });
  ```

> **Note** — The broadcast channel requires `BroadcastProvider` to be registered.

A broadcast goes out inline, which is the point of the channel. When one fans out
widely enough that the request should not wait for it, `.onQueue(name)` hands it
to a worker instead — at the cost of arriving whenever that worker picks it up.

```ts
// in a Notification
toBroadcast(_n: Notifiable) {
  return new BroadcastMessage({ id: this.report.id }).onQueue("broadcasts");
}
```

## Custom channels

The five built-in channels are registered the same way yours are, so adding a
channel is not a special case. Register a factory under a name, and any
notification can declare it:

```ts
// app/providers/DiscordChannelProvider.ts
import type { NotificationChannel, Notifiable } from "@zerotal/notifications";

class DiscordChannel implements NotificationChannel {
  async send(notifiable: Notifiable, notification: Notification) {
    const message = await (
      notification as { toDiscord(n: Notifiable): { content: string } }
    ).toDiscord(notifiable);
    await fetch(notifiable.routeNotificationFor?.("discord") ?? this.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }
}

// in the provider's onBooted()
const notifications = this.app.container.makeSync("notifications");
notifications.extend("discord", () => new DiscordChannel());
```

```ts
// app/notifications/DeployFinished.ts
channels() {
  return ["database", "discord"];
}

toDiscord(_n: Notifiable) {
  return { content: `Deploy ${this.build.sha} finished` };
}
```

The factory runs once, the first time something sends on that channel, so a
channel nobody uses costs nothing. Registering a name that already exists
replaces it, which is how you swap a built-in channel for your own
implementation. Sending on a name that was never registered raises an
`UnknownNotificationChannelError` listing the names that were.

## Queued notifications

`notifyLater()` and `Notify.queue()` hand delivery to
[the queue](/docs/queue). With the sync driver the notification is passed
through in memory; with a persistent driver (SQLite or Redis) it is serialized,
so both the notification and its recipient have to survive a round trip through
JSON.

Two consequences are worth knowing before you queue anything.

**The recipient crosses as a snapshot.** Channels read the `Notifiable` contract
plus whatever else the model exposes through `toJSON()`, and the rebuilt
recipient is a plain object. Read fields on a notifiable, not methods, in any
notification you queue.

**The notification is rebuilt by class name.** Classes under
`app/notifications/` are found automatically. One that lives elsewhere must
register itself:

```ts
// app/domain/billing/InvoiceOverdue.ts
import { NotificationRegistry } from "@zerotal/notifications";

export class InvoiceOverdue extends Notification {
  /* … */
}

NotificationRegistry.register(InvoiceOverdue);
```

By default a notification's own enumerable fields are serialized, which covers a
constructor that assigns plain values. When it holds something JSON cannot carry
— a model instance, a `Map`, a closure — say how to shrink and rebuild it:

```ts
// app/notifications/InvoicePaid.ts
export class InvoicePaid extends Notification {
  constructor(private invoice: Invoice) {
    super();
  }

  override payload() {
    return { invoiceId: this.invoice.id };
  }

  static override async fromPayload(data: Record<string, unknown>) {
    return new InvoicePaid(await Invoice.findOrFail(data["invoiceId"] as number));
  }
}
```

## Testing

`NotificationFake` swaps the `"notifications"` container binding for an
in-memory recorder, so assertions run without hitting any real channel:

```ts
// tests/orders.test.ts
import { NotificationFake } from "@zerotal/notifications";
import { describe, it, beforeEach, afterEach } from "bun:test";

let notify: NotificationFake;

beforeEach(() => {
  notify = NotificationFake.install();
});
afterEach(() => notify.restore());

it("notifies the user when order ships", async () => {
  const user = await UserFactory.create();
  const order = await OrderFactory.create({ userId: user.id });

  await triggerShipment(order);

  // Assert the right user got the right notification
  notify.assertSentTo(user, OrderShippedNotification);

  // With an optional filter callback
  notify.assertSentTo(user, OrderShippedNotification, (n) => n instanceof OrderShippedNotification);

  // Assert a notification was NOT sent to a specific user
  notify.assertNotSentTo(adminUser, OrderShippedNotification);

  // Assert the channels it was declared to go out on
  notify.assertSentOn(user, OrderShippedNotification, "mail");

  // Assert it was queued rather than sent immediately
  notify.assertQueued(user, OrderShippedNotification);

  // Assert how many times one class was sent, across all recipients
  notify.assertSentTimes(OrderShippedNotification, 1);

  // Assert the exact total count
  notify.assertSentCount(1);

  // Assert nothing at all was sent
  // notify.assertNothingSent();
});
```

A failing assertion prints what was actually captured — the notification, the
recipient, its channels, and whether it was queued — which is normally the fact
you need next.

> **Warning** — `NotificationFake.install()` captures `send` _and_ `queue`, but
> it has no channel behaviour — `toDatabase()` rows are never written. Its
> `database` accessor answers as an empty inbox so code under test that reads
> `unreadNotifications()` keeps working; assert on what was sent, not on the
> inbox, inside a faked test.

## Watching deliveries

With [`@zerotal/admin`](/docs/admin) installed, the notifications console
appears under Operations, gated on the `notifications.view` ability. It shows
recent delivery attempts with the channel, recipient, duration, and the
provider's own error text; per-channel totals since boot, which is where a
failing channel stands out; and the stored inbox, with actions to delete a row or
prune read notifications.

The recent-delivery and per-channel figures are in-process counters, not history
— they reset when the process does. The durable record of a notification is the
database channel.

## References

### NotificationManager

| Method      | Signature                                                                          | Description                                        |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `send`      | `(notifiable: Notifiable, notification: Notification) => Promise<void>`            | Deliver over every declared channel now.           |
| `sendMany`  | `(notifiables: Iterable<Notifiable>, notification: Notification) => Promise<void>` | Deliver to many recipients now.                    |
| `queue`     | `(notifiable: Notifiable, notification: Notification) => Promise<void>`            | Queue for background delivery via the queue.       |
| `queueMany` | `(notifiables: Iterable<Notifiable>, notification: Notification) => Promise<void>` | Queue for many recipients.                         |
| `route`     | `(routes: OnDemandRoutes) => { notify, notifyLater }`                              | Address a destination with no model behind it.     |
| `extend`    | `(channel: string, factory: () => NotificationChannel) => this`                    | Register a custom channel, or replace a built-in.  |
| `channels`  | `() => string[]`                                                                   | Every registered channel name.                     |
| `database`  | `DatabaseChannel` (getter)                                                         | Direct access to the database channel for queries. |

The `Notify` facade proxies these — `Notify.send(...)`, `Notify.sendMany(...)`,
`Notify.queue(...)`, `Notify.route(...)`.

### Notification (extend this)

Every `to*()` method may return its message directly or a promise of it, so
building one can do I/O — reading an attachment, loading a record.

| Member          | Signature                                                                 | Description                                          |
| --------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `channels`      | `(notifiable?: Notifiable) => string[]`                                   | Declare the channels to deliver on (abstract).       |
| `toMail`        | `(notifiable: Notifiable) => MailMessage`                                 | Build the email for the `mail` channel.              |
| `toDatabase`    | `(notifiable: Notifiable) => Record<string, unknown>`                     | Build the stored payload for the `database` channel. |
| `toSlack`       | `(notifiable: Notifiable) => SlackMessage`                                | Build the Slack message for the `slack` channel.     |
| `toSms`         | `(notifiable: Notifiable) => SmsMessage`                                  | Build the SMS for the `sms` channel.                 |
| `toBroadcast`   | `(notifiable: Notifiable) => BroadcastMessage \| Record<string, unknown>` | Build the broadcast payload.                         |
| `broadcastType` | `() => string`                                                            | Wire `type` of a broadcast (default: class name).    |
| `payload`       | `() => Record<string, unknown>`                                           | State to store when queued (default: own fields).    |
| `fromPayload`   | `static (data) => Notification \| Promise<Notification>`                  | Rebuild from stored state (optional).                |

### Notifiable mixin

| Method                    | Signature                                               | Description                                  |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `notify`                  | `(n: Notification) => Promise<void>`                    | Send now across the notification's channels. |
| `notifyLater`             | `(n: Notification) => Promise<void>`                    | Queue for background delivery.               |
| `notifications`           | `(query?: InboxQuery) => Promise<NotificationRecord[]>` | All stored notifications, newest first.      |
| `unreadNotifications`     | `(query?: InboxQuery) => Promise<NotificationRecord[]>` | Unread stored notifications, newest first.   |
| `unreadNotificationCount` | `() => Promise<number>`                                 | Unread count, without loading rows.          |
| `markNotificationsAsRead` | `() => Promise<void>`                                   | Mark all unread notifications as read.       |
| `clearNotifications`      | `() => Promise<void>`                                   | Delete every stored notification.            |

### NotificationFake

| Method                                     | Description                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `NotificationFake.install()`               | Replace the `"notifications"` container binding. Returns the `NotificationFake` instance. |
| `restore()`                                | Restore the original binding. Call in `afterEach`.                                        |
| `sent()`                                   | Return all captured `{ notifiable, notification }` pairs.                                 |
| `sentTo(notifiable)`                       | Return the captured notifications for one recipient.                                      |
| `assertSentTo(notifiable, Class, filter?)` | Throw if `Class` was not sent to `notifiable`.                                            |
| `assertNotSentTo(notifiable, Class)`       | Throw if `Class` was sent to `notifiable`.                                                |
| `assertSentOn(notifiable, Class, channel)` | Throw unless `Class` declared `channel` for `notifiable`.                                 |
| `assertQueued(notifiable, Class)`          | Throw unless `Class` was queued rather than sent immediately.                             |
| `assertSentTimes(Class, n)`                | Throw if `Class` was not sent exactly `n` times, across all recipients.                   |
| `assertNothingSent()`                      | Throw if any notification was sent.                                                       |
| `assertSentCount(n)`                       | Throw if total sent count is not `n`.                                                     |

## Next steps

- [Broadcasting](/docs/broadcasting) — the real-time broadcast channel and channel auth.
- [Queue](/docs/queue) — background delivery with `notifyLater()` / `Notify.queue()`.
- [Database](/docs/database) — where stored notifications live.
- [Admin](/docs/admin) — the panel hosting the notifications console.
