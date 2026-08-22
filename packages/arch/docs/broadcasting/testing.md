---
title: Testing Broadcasting
description: Fake the broadcaster and assert on what would have been sent.
---

# Testing

A broadcast is a side effect that leaves your process, which makes it awkward to
observe and slow to exercise against a real driver. `Broadcast.fake()` swaps the
live manager for an in-memory recorder, so the code under test broadcasts exactly
as it normally would and the test inspects what came out — no Redis, no Pusher
credentials, and no waiting on a socket.

```ts fragment
// in a test
import { Broadcast } from "@zerotal/broadcasting";

const fake = Broadcast.fake();

// Run code that broadcasts
await PostController.publish({ http: ctx });

// Assert by event name (and optionally channel + partial payload)
fake.assertBroadcast("PostPublished", "posts");
fake.assertBroadcast("PostPublished", "posts", { id: post.id });

Broadcast.resetFake();
```

`fake()` stays installed until you remove it, so restore the real manager in
`afterEach` — otherwise the first test to fake broadcasting silently mutes every
test that follows it.

```ts fragment
afterEach(() => Broadcast.resetFake());
```

## Available assertions

| Method                                    | Passes when …                                          |
| ----------------------------------------- | ------------------------------------------------------ |
| `assertBroadcast(event, channel?, data?)` | A matching broadcast was recorded.                     |
| `assertNotBroadcast(event, channel?)`     | No matching broadcast was recorded.                    |
| `assertNothingBroadcast()`                | Nothing at all was broadcast.                          |
| `assertBroadcastCount(n)`                 | Exactly `n` broadcasts were recorded.                  |
| `recorded()`                              | Returns the raw `{ channel, event, data }[]` list.     |
| `reset()`                                 | Clears recorded broadcasts (keeps the fake installed). |

The `data` argument to `assertBroadcast` is a **partial** match — only the keys you
pass are compared, so you can assert on a single field without spelling out the
whole payload.

Arguments narrow the match rather than replace it. `assertBroadcast("PostPublished")`
accepts the event on any channel with any payload; adding a channel demands that
channel too; adding data demands those keys as well. Start broad and tighten only
to the part the test is actually about, so unrelated payload changes do not break it.

When an assertion fails, the error lists everything that _was_ recorded — usually
enough to see that the event fired on a different channel, or under a different
name than `broadcastAs()` produces.

## reset() or resetFake()?

Two similarly named calls do different jobs, and reaching for the wrong one is the
usual cause of a test that passes alone and fails in a suite:

- **`fake.reset()`** empties the recorded list and leaves the fake installed. Use it
  between phases of one test — arrange, clear, then assert only on what the action
  under test produced.
- **`Broadcast.resetFake()`** removes the fake entirely and restores container-backed
  resolution. Use it in `afterEach`.

## Asserting nothing was sent

Proving a broadcast did _not_ happen is often the more valuable test, because a
stray broadcast reaches real users. Both negative assertions are worth reaching
for:

```ts fragment
it("does not broadcast when validation fails", async () => {
  const fake = Broadcast.fake();

  await PostController.publish({ http: invalidCtx });

  fake.assertNothingBroadcast();
});

it("broadcasts the update but not a deletion", async () => {
  const fake = Broadcast.fake();

  await post.update({ title: "Edited" });

  fake.assertBroadcast("PostUpdated");
  fake.assertNotBroadcast("PostDeleted");
});
```

## Model broadcasts

Models that broadcast their own changes go through the same manager, so they need
no special handling — save the model and assert. The event name is whatever
`broadcastAs()` returns and the payload whatever `broadcastWith()` builds, so
asserting on both is what pins that mapping down:

```ts fragment
const fake = Broadcast.fake();

await Post.create({ title: "Hello" });

fake.assertBroadcast("PostCreated", "posts", { title: "Hello" });
```

## Broadcasts that skip the sender

`broadcast(event).toOthers()` excludes the connection that triggered it by passing
its socket id along. The fake records the broadcast either way, so a test that only
asserts the event fired will pass whether or not `toOthers()` was used. To pin that
behaviour down, read the recorded entries directly:

```ts fragment
const [entry] = fake.recorded();
expect(entry.event).toBe("PostUpdated");
```

`recorded()` is the escape hatch generally — when an assertion helper does not
express the question, the raw `{ channel, event, data }` list will.

## Next steps

- [Broadcasting overview](/docs/broadcasting) — the guide's front page and the rest of the sections.
- [Events](/docs/broadcasting/events) — writing the events these tests assert on.
- [Channels](/docs/broadcasting/channels) — the channels they are sent to.
