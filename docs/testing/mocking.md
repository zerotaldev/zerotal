---
title: Mocking
description: Swap real services for in-memory fakes so tests can assert side effects without doing real I/O.
---

# Mocking

To test that code _triggers_ a side effect — queues a job, notifies a user,
broadcasts an event — swap the real service for an in-memory **fake**. The fake
records each call so you can assert on it, and performs no real I/O.

`EventFake`, `QueueFake`, and `NotificationFake` share an `install()` /
`restore()` lifecycle that swaps a container binding; broadcasting, storage, and
the HTTP client are faked through their own facades. All record-and-assert without
touching the network or the disk.

> **Danger** — A fake performs no real I/O. If a fake is still installed when a
> later test expects real delivery, jobs and notifications silently vanish —
> always restore it in `afterEach`.

## Which fake do I use?

- **Emitting a domain event?** Use `EventFake` — captures every `Events.emit()`
  and stops its listeners from running.
- **Queueing a job?** Use `QueueFake` — captures every `Queue.dispatch()`.
- **Sending a notification** (including the `mail` channel)? Use
  `NotificationFake` — captures every `Notify.send()` / `Notify.queue()`.
- **Broadcasting an event** over WebSockets? Use `Broadcast.fake()` — records
  every `Broadcast.send()` / `Broadcast.to()`.
- **Writing a file to a disk?** Use `Storage.fake()` — an in-memory disk that
  records what was stored.
- **Calling another service over HTTP?** Use `Http.fake()` — stubs outbound
  requests so no real network call is made.
- **Signing in through an OAuth provider?** Use `Social.fake()` from
  `@zerotal/auth` — returns a canned profile instead of exchanging a code.
- **Depending on the passage of time?** Freeze the clock with `Carbon.freeze()`
  rather than installing a fake.
- **Need filler test data** (names, emails, dates)? Use [`fake`](#generating-fake-data),
  the data generator — it has nothing to do with the service fakes above.

Everything except `Broadcast.fake()` and `Social.fake()` is re-exported from
`@zerotal/testing`, so a test rarely has to know which package a fake ships in.

## Events

`EventFake.install()` replaces the `events` binding, so emitted events are
recorded and their listeners never run.

```typescript
// src/tests/PostPublishTest.ts
import { EventFake } from "@zerotal/testing";

let events: EventFake;
beforeEach(() => {
  events = EventFake.install();
});
afterEach(() => events.restore());

it("announces that a post was published", async () => {
  const post = await PostFactory.create({ status: "draft" });

  await post.publish();

  events.assertEmitted(PostPublished);
  events.assertEmitted(PostPublished, (e) => e.postId === post.id);
  events.assertNotEmitted(PostDeleted);
  events.assertEmittedCount(PostPublished, 1);
});
```

Faking the emitter is what lets this test assert that publishing _announces_
itself without also running everything that reacts to the announcement — mail,
search indexing, cache invalidation.

> **Warning** — To test a listener, do not fake. Construct the listener and hand
> it an event directly; the fake stops listeners from running at all.

## Queue

`QueueFake.install()` replaces the `queue` binding so dispatched jobs are
captured instead of persisted or executed.

```typescript
// src/tests/PostPublishTest.ts
import { QueueFake } from "@zerotal/testing"; // re-exported from @zerotal/queue

let queue: QueueFake;
beforeEach(() => {
  queue = QueueFake.install();
});
afterEach(() => queue.restore());

it("queues a job when a post is published", async () => {
  const post = await PostFactory.create({ status: "draft" });
  await post.transitionTo("published");

  queue.assertDispatched(NotifySubscribersJob);
  queue.assertDispatched(NotifySubscribersJob, (j) => j.postId === post.id);
  queue.assertNotDispatched(ProcessPaymentJob);
  queue.assertDispatchedCount(1);
  queue.assertNothingDispatched(); // for isolation tests
});
```

> **Warning** — The fake captures the job but never calls its `handle()`. To test
> the job's body, instantiate and `await` it directly instead of faking.

## Notifications

`NotificationFake.install()` replaces the `notifications` binding. Both
`Notify.send()` and `Notify.queue()` are captured as "sent". The `mail` channel
runs through `Notify`, so faking notifications also covers email side effects.

```typescript
// src/tests/InvoiceTest.ts
import { NotificationFake } from "@zerotal/testing"; // re-exported from @zerotal/notifications
import { Notify } from "@zerotal/notifications";

let notify: NotificationFake;
beforeEach(() => {
  notify = NotificationFake.install();
});
afterEach(() => notify.restore());

it("notifies the user when an invoice is ready", async () => {
  const user = await UserFactory.create();
  const invoice = await InvoiceFactory.create({ userId: user.id });

  await Notify.send(user, new InvoiceReady(invoice));

  notify.assertSentTo(user, InvoiceReady);
  notify.assertSentTo(user, InvoiceReady, (n) => n.invoiceId === invoice.id);
  notify.assertNotSentTo(adminUser, InvoiceReady);
  notify.assertSentCount(1);
  notify.assertNothingSent(); // for isolation tests
});
```

## Broadcasting

The `Broadcast` facade has its own recorder. Call `Broadcast.fake()` to install
it and `Broadcast.resetFake()` to restore — the returned fake exposes the
assertions:

```typescript
// src/tests/PostBroadcastTest.ts
import { Broadcast } from "@zerotal/broadcasting";

const fake = Broadcast.fake();

await PostController.publish({ http: ctx });

fake.assertBroadcast("PostPublished", "posts");
fake.assertBroadcast("PostPublished", "posts", { id: post.id }); // partial payload match
fake.assertNothingBroadcast();

Broadcast.resetFake();
```

`assertBroadcast(eventName, channel?, data?)` matches on the broadcast-as name
first, then the channel, then a partial payload. See
[Broadcasting › Testing](/docs/broadcasting/testing) for the full assertion set.

## Storage

`Storage.fake()` swaps a disk for an in-memory one and returns it. Nothing
touches the filesystem, so each test starts empty by construction rather than by
remembering to clean up — and a suite that forgets to clean up passes the second
time for the wrong reason.

```typescript
// src/tests/AvatarTest.ts
import { Storage } from "zerotal/storage";
import { fakeFile } from "@zerotal/testing";

let disk: ReturnType<typeof Storage.fake>;
beforeEach(() => {
  disk = Storage.fake(); // or Storage.fake('s3') for a named disk
});
afterEach(() => Storage.restoreFakes());

it("stores an uploaded avatar", async () => {
  const res = await app.actingAs(user).multipart("/avatar", {
    avatar: fakeFile.image("me.png"),
  });

  res.assertCreated();
  disk.assertExistsMatching(/^avatars\/[0-9a-f-]+\.png$/);
  disk.assertContentType(disk.paths()[0]!, "image/png");
  disk.assertCount(1);
});
```

Uploads are stored under a generated name, which is why `assertExistsMatching`
takes a pattern. When you control the path, `assertExists(path, contents?)` checks
it directly.

## Outbound HTTP

`Http.fake()` intercepts requests made through the [`Http`](/docs/helpers)
client, so a test that exercises a service integration makes no real network
call — and does not fail when that service is down or rate-limits you.

```typescript
// src/tests/PaymentTest.ts
import { Http } from "@zerotal/testing";

beforeEach(() => {
  Http.fake([
    { url: "https://api.payments.test/charges", body: { id: "ch_1", status: "paid" } },
    { url: "*", status: 404 }, // anything else is a mistake, and says so
  ]);
});
afterEach(() => Http.resetFakes());

it("charges the card and records the reference", async () => {
  await checkout.pay(order);

  Http.assertSent((req) => req.url.includes("/charges") && req.method === "POST");
  Http.assertSentCount(1);
  await assertDatabaseHas("orders", { payment_reference: "ch_1" });
});
```

A catch-all stub at the end is worth adding: without it an unstubbed URL falls
through, and a test can quietly start depending on a service being reachable.

## Time

Behaviour that depends on the passage of time — a token that expires in seven
days, a reminder that only fires after 24 hours — has no way to be tested except
by waiting. Freeze the clock instead:

```typescript
// src/tests/InvitationTest.ts
import { Carbon } from "zerotal";

afterEach(() => Carbon.release());

it("expires an invitation after seven days", async () => {
  Carbon.freeze("2025-01-01T00:00:00Z");
  const invitation = await InvitationFactory.create();

  expect(invitation.isExpired()).toBe(false);

  Carbon.travel({ days: 8 });

  expect(invitation.isExpired()).toBe(true);
});
```

| Member                     | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `Carbon.freeze(value?)`    | Freeze at `value`, or at the current instant.                |
| `Carbon.setTestNow(value)` | Freeze at an absolute point; `null` releases.                |
| `Carbon.travelTo(value)`   | Jump to an absolute point.                                   |
| `Carbon.travel(amount)`    | Move relative to now; negative values go back.               |
| `Carbon.withTestNow(v, f)` | Freeze for the duration of `f`, releasing even if it throws. |
| `Carbon.release()`         | Let the clock run normally again.                            |
| `Carbon.isFrozen()`        | Whether the clock is currently frozen.                       |

> **Danger** — Always release the clock in an `afterEach`. A frozen clock that
> outlives its test makes the next one fail somewhere unrelated.

This moves Carbon's clock, which is what `Carbon.now()` and everything built on
it read — `isPast`, `isToday`, `diffForHumans`, a model's timestamps. A raw
`Date.now()` is unaffected, so code that must be testable against time should go
through [Carbon](/docs/carbon).

## Generating fake data

`fake` is a zero-dependency, South-African-flavoured data generator for filling
in test values — used inside [factories](/docs/orm/factories) or directly in a
test. It is unrelated to the service fakes above.

```typescript
// src/tests/example.ts
import { fake } from "@zerotal/testing";

// Identity
fake.name(); // "Sipho Dlamini"
fake.email(); // "sipho.dlamini73@gmail.com"
fake.email({ corporate: true }); // "sipho.dlamini@shoprite.co.za"
fake.phone(); // "071 234 5678"

// Location & business
fake.city();
fake.province();
fake.suburb();
fake.streetAddress();
fake.postalCode();
fake.company();
fake.jobTitle();
fake.department();

// Primitives
fake.string(10); // random alphanumeric
fake.number(1, 1000); // integer in [1, 1000]
fake.float(0, 1, 2); // 2-decimal float
fake.boolean(0.8); // true 80% of the time
fake.uuid();
fake.maybe("val", 0.5); // value or null

// Dates
fake.date();
fake.pastDate(3);
fake.futureDate(2);
fake.isoDate();
fake.timestamp();

// Text
fake.word();
fake.words(5);
fake.sentence();
fake.paragraph();
fake.title();
fake.slug("My Title");

// Arrays
fake.pick([1, 2, 3]); // random element
fake.shuffle([1, 2, 3]); // shuffled copy
fake.sample([1, 2, 3, 4], 2); // 2 unique random picks
```

## References

`EventFake` — captures emitted events:

| Method                 | Signature                                     | Description                                               |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `install`              | `static install(): EventFake`                 | Swap the `events` binding for the fake.                   |
| `restore`              | `restore(): void`                             | Restore the original `events` binding.                    |
| `emitted`              | `emitted(): object[]`                         | All captured events, in emit order.                       |
| `emittedOf`            | `emittedOf(EventClass): T[]`                  | The captured events of one class, typed.                  |
| `assertEmitted`        | `assertEmitted(EventClass, filter?): void`    | An event of that class was emitted (optionally matching). |
| `assertNotEmitted`     | `assertNotEmitted(EventClass, filter?): void` | No such event was emitted.                                |
| `assertEmittedCount`   | `assertEmittedCount(EventClass, count): void` | Exactly `count` events of that class were emitted.        |
| `assertNothingEmitted` | `assertNothingEmitted(): void`                | No events were emitted at all.                            |
| `clear`                | `clear(): void`                               | Discard what has been captured so far.                    |

`FakeDisk` — returned by `Storage.fake()`:

| Method                 | Signature                                     | Description                                            |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `assertExists`         | `assertExists(path, contents?): this`         | A file is stored at `path` (optionally with contents). |
| `assertMissing`        | `assertMissing(path): this`                   | Nothing is stored at `path`.                           |
| `assertExistsMatching` | `assertExistsMatching(pattern: RegExp): this` | Some stored path matches `pattern`.                    |
| `assertContentType`    | `assertContentType(path, type): this`         | The file was stored with that content type.            |
| `assertCount`          | `assertCount(expected): this`                 | Exactly `expected` files are stored.                   |
| `assertNothingStored`  | `assertNothingStored(): this`                 | Nothing was stored.                                    |
| `paths` / `file`       | `paths(): string[]` / `file(path)`            | Inspect what is stored.                                |
| `clear`                | `clear(): void`                               | Empty the disk.                                        |

`Http` — the outbound HTTP client's own harness:

| Method              | Signature                            | Description                                         |
| ------------------- | ------------------------------------ | --------------------------------------------------- |
| `fake`              | `static fake(stubs?): void`          | Intercept outbound requests with stubbed responses. |
| `resetFakes`        | `static resetFakes(): void`          | Restore real HTTP behaviour.                        |
| `recorded`          | `static recorded(): Array<…>`        | Every request recorded since `fake()`.              |
| `assertSent`        | `static assertSent(predicate): void` | A matching request was sent.                        |
| `assertNotSent`     | `static assertNotSent(pred): void`   | No matching request was sent.                       |
| `assertSentCount`   | `static assertSentCount(n): void`    | Exactly `n` requests were sent.                     |
| `assertNothingSent` | `static assertNothingSent(): void`   | No requests were sent at all.                       |

`QueueFake` — captures dispatched jobs:

| Method                    | Signature                                   | Description                                                        |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `install`                 | `static install(): QueueFake`               | Swap the `queue` binding for the fake.                             |
| `restore`                 | `restore(): void`                           | Restore the original `queue` binding.                              |
| `dispatched`              | `dispatched(): Job[]`                       | All captured jobs.                                                 |
| `assertDispatched`        | `assertDispatched(JobClass, filter?): void` | A job of that class was dispatched (optionally matching `filter`). |
| `assertNotDispatched`     | `assertNotDispatched(JobClass): void`       | No job of that class was dispatched.                               |
| `assertNothingDispatched` | `assertNothingDispatched(): void`           | No jobs were dispatched at all.                                    |
| `assertDispatchedCount`   | `assertDispatchedCount(count): void`        | Exactly `count` jobs were dispatched.                              |

`NotificationFake` — captures sent notifications:

| Method              | Signature                                                    | Description                                              |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `install`           | `static install(): NotificationFake`                         | Swap the `notifications` binding for the fake.           |
| `restore`           | `restore(): void`                                            | Restore the original `notifications` binding.            |
| `sent`              | `sent(): CapturedNotification[]`                             | All captured `{ notifiable, notification }` pairs.       |
| `assertSentTo`      | `assertSentTo(notifiable, NotificationClass, filter?): void` | A notification of that class was sent to the notifiable. |
| `assertNotSentTo`   | `assertNotSentTo(notifiable, NotificationClass): void`       | That class was not sent to the notifiable.               |
| `assertNothingSent` | `assertNothingSent(): void`                                  | No notifications were sent at all.                       |
| `assertSentCount`   | `assertSentCount(count): void`                               | Exactly `count` notifications were sent.                 |

`BroadcastFake` — returned by `Broadcast.fake()`:

| Method                   | Signature                                           | Description                                                                    |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `recorded`               | `recorded(): RecordedBroadcast[]`                   | All recorded `{ channel, event, data }` broadcasts.                            |
| `reset`                  | `reset(): void`                                     | Clear recorded broadcasts.                                                     |
| `assertBroadcast`        | `assertBroadcast(eventName, channel?, data?): void` | An event was broadcast (optionally on `channel`, with a partial `data` match). |
| `assertNotBroadcast`     | `assertNotBroadcast(eventName, channel?): void`     | That event was not broadcast.                                                  |
| `assertNothingBroadcast` | `assertNothingBroadcast(): void`                    | No broadcasts were recorded.                                                   |
| `assertBroadcastCount`   | `assertBroadcastCount(count): void`                 | Exactly `count` broadcasts were recorded.                                      |

## Next steps

- [Factories](/docs/orm/factories) — where `fake` is most often used.
- [Events](/docs/events) — the real emitter `EventFake` stands in for.
- [Queue](/docs/queue) — the real queue `QueueFake` stands in for.
- [Notifications](/docs/notifications) — the real notifier `NotificationFake` stands in for, including the `mail` channel.
- [Storage](/docs/storage) — the disks `Storage.fake()` stands in for.
- [Carbon](/docs/carbon) — the date-time API whose clock the time helpers move.
- [Console Tests](/docs/testing/console) — assert side effects of CLI commands.
- [Database](/docs/testing/database) — assert rows alongside faked side effects.
