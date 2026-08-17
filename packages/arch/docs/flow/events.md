---
title: Flow Events & Broadcasting
description: Component events, browser events, and multiplayer state shared over WebSockets.
---

# Events & Broadcasting

Flow components communicate by dispatching named events. Listeners registered with `@on` are notified and can refresh their own state. Events can be targeted at all components, a specific class, or just the sender. The same mechanism extends to real-time server broadcasts over WebSockets.

## Dispatching events from the server

Call `this.dispatch()` inside any `@expose`d action. The event is delivered to all matching `@on` listeners on the page after the action completes:

```typescript
@expose async save(): Promise<void> {
  const post = await Post.create({
    title:  this.title,
    body:   this.body,
    userId: this.currentUserId,
  });

  // Notify every component on the page
  this.dispatch("post-created", { id: post.id, title: post.title });
  this.redirect(`/posts/${post.id}`);
}
```

The second argument is the payload — any JSON-serialisable value. Omit it for events that carry no data:

```typescript
this.dispatch("cart-cleared");
```

## Targeting specific components

By default, `dispatch()` notifies every `@on` listener on the page. Use `dispatchTo` or `dispatchSelf` to narrow the target:

```typescript
// Default: all @on("post-created") listeners on the page
this.dispatch("post-created", { id });

// Only the PostList component class
this.dispatchTo("PostList", "post-created", { id });

// Only this component instance (self-notification)
this.dispatchSelf("refresh");
```

`dispatchTo` matches by class name (the `name` property of the class), not by file path or import. If you have two mounted `PostList` instances on the page, both receive the event — targeting narrows by _class_, not by _instance_.

## Listening for events

Register a method as an event listener with `@on`. The method is **implicitly exposed** — no `@expose` needed:

```typescript
import { on } from "@zerotal/flow";

export class PostList extends Component {
  @locked posts: Post[] = [];

  override async onMount() {
    this.posts = await Post.query().orderBy("created_at", "desc").limit(20).get();
  }

  // This fires whenever any component dispatches "post-created":
  @on("post-created")
  async handlePostCreated(data: { id: number; title: string }): Promise<void> {
    // Prepend the new post without a full reload
    const newPost = await Post.findOrFail(data.id);
    this.posts = [newPost, ...this.posts.slice(0, 19)];
    this.flash(`"${data.title}" was published.`, "success");
  }

  // Listen for a deletion too
  @on("post-deleted")
  async handlePostDeleted(data: { id: number }): Promise<void> {
    this.posts = this.posts.filter((p) => p.id !== data.id);
  }

  override async render() {
    return (
      <ul>
        {this.posts.map((p) => (
          <li key={String(p.id)}>{p.title}</li>
        ))}
      </ul>
    );
  }
}
```

A component can have as many `@on` listeners as it needs. Each fires independently in the order events are dispatched.

## Multiple listeners for the same event

Several components on the same page can all listen for the same event. Each component is updated independently — Flow sends a separate patch frame to each listener:

```typescript
// PostList.tsx
@on("post-created")
async onPostCreated(data: { id: number }) {
  this.posts = await Post.query().orderBy("created_at", "desc").limit(10).get();
}

// PostCount.tsx (different component, same page)
@on("post-created")
async onPostCreated() {
  this.count++;
}

// ActivityFeed.tsx (different component, same page)
@on("post-created")
async onPostCreated(data: { id: number; title: string }) {
  this.activities.unshift({ type: "post", title: data.title, at: new Date() });
}
```

All three components update after a single `this.dispatch("post-created", ...)` call.

## Dispatching from the browser

The same `dispatch`, `dispatchTo`, and `dispatchSelf` methods work inside **client expressions** — no server round-trip needed to start the dispatch. The `@on` listeners still run server-side when they're notified:

```tsx
{
  /* Notify all listeners without a preceding server action */
}
<button onClick={() => this.dispatch("sidebar-opened")}>Open sidebar</button>;

{
  /* Notify only the Sidebar component */
}
<button onClick={() => this.dispatchTo("Sidebar", "refresh")}>Refresh sidebar</button>;

{
  /* Self-reset */
}
<button onClick={() => this.dispatchSelf("reset")}>Reset</button>;
```

This pattern is useful when the dispatch itself doesn't require a server round-trip, but the listener's response does.

## Type-safe events

Events are string-keyed at runtime, but their payloads can be type-checked end-to-end — no codegen. Declare a contract by augmenting the `FlowEvents` interface (one `.d.ts` in your app), mapping each event name to its payload type:

```ts
// app/flow-events.d.ts
import "@zerotal/flow";

declare module "@zerotal/flow" {
  interface FlowEvents {
    "post-created": { id: number; title: string };
    "cart-cleared": void; // no payload
  }
}
```

Every `dispatch` / `dispatchTo` / `dispatchSelf` site is now checked against it — in server actions **and** client expressions, since they call the same typed method:

```ts
this.dispatch("post-created", { id: post.id, title: post.title }); // ✓
this.dispatch("post-created", { id: post.id }); // ✗ missing `title`
this.dispatch("post-created"); // ✗ payload required
this.dispatch("cart-cleared"); // ✓ void → no payload
this.dispatch("cart-cleared", { anything: 1 }); // ✗ void takes no payload
```

On the listener side, `@on` autocompletes to the known event names, and you annotate the handler's parameter with `EventPayload<K>` to type the payload against the same contract:

```ts
import { on } from "@zerotal/flow";
import type { EventPayload } from "@zerotal/flow";

@on("post-created")
async onPostCreated(data: EventPayload<"post-created">) {
  this.latest = await Post.findOrFail(data.id); // data is { id: number; title: string }
}
```

Adoption is gradual and non-breaking: any event name **not** in the contract stays untyped (a plain optional-payload call), so existing events and `@on("echo:…")` broadcasts keep compiling — you type the ones you care about, when you care about them.

**Runtime guard (optional).** The types cover your own dispatch sites at compile time. For a payload that arrives from an untrusted source — a client-originated dispatch — register a runtime guard; a violating payload then throws from `dispatch` instead of reaching listeners:

```ts
import { registerFlowEvent } from "@zerotal/flow";

registerFlowEvent(
  "post-created",
  (p): p is { id: number; title: string } => typeof (p as { id?: unknown })?.id === "number",
);
```

## Native window events

Every dispatched event is also emitted as a native `flow:<name>` event on `window`. Alpine and plain JavaScript can listen:

```html
<!-- Alpine listener -->
<div x-on:flow:post-created.window="latestTitle = $event.detail.title">
  Latest: <span x-text="latestTitle"></span>
</div>

<!-- Vanilla JS -->
<script>
  window.addEventListener("flow:post-created", (e) => {
    console.log("Post created:", e.detail);
  });
</script>
```

The `detail` property of the event contains the payload passed to `dispatch()`. This is useful when you need to react in JavaScript code outside the Flow component tree.

## Calling the parent directly

When a child component just needs to invoke a parent action, use `$flow.parent` instead of events — it's more direct and avoids polluting the global event space:

```tsx
{
  /* In the child component's template: */
}
<button onClick={() => $flow.parent.showCreateForm()}>New post</button>;

{
  /* Read the parent's exposed state: */
}
<span x-text="$flow.parent.title" />;
```

`$flow.parent.method(args)` dispatches the action to the nearest ancestor component in the DOM tree. It resolves to the live client parent state; from a server action, use events instead.

## Real-time broadcasting

Listen for server-broadcast events over WebSockets with `@on("echo:…")`. When a matching broadcast arrives, the listener method runs server-side exactly like any other action — the component re-renders live.

```typescript
export class OrderDashboard extends Component {
  @locked orderCount: number = 0;
  @locked recentOrders: Order[] = [];

  override async onMount() {
    this.orderCount   = await Order.count();
    this.recentOrders = await Order.query().orderBy("created_at", "desc").limit(5).get();
  }

  @on("echo:orders,OrderPlaced")
  async onOrderPlaced(payload: { id: number; total: number }): Promise<void> {
    this.orderCount++;
    const order = await Order.findOrFail(payload.id);
    this.recentOrders = [order, ...this.recentOrders.slice(0, 4)];
    this.flash(`New order — $${payload.total}`, "success");
  }

  @on((self) => `echo-private:orders.${self.branchId},OrderCancelled`)
  async onOrderCancelled(payload: { id: number }): Promise<void> {
    this.recentOrders = this.recentOrders.filter((o) => o.id !== payload.id);
    this.orderCount   = Math.max(0, this.orderCount - 1);
  }

  override async render() {
    return (
      <div>
        <h2>Orders today: {this.orderCount}</h2>
        <ul>
          {this.recentOrders.map((o) => (
            <li key={String(o.id)}>#{o.id} — ${o.total}</li>
          ))}
        </ul>
      </div>
    );
  }
}
```

### Channel name formats

| Format                             | Channel type                            |
| ---------------------------------- | --------------------------------------- |
| `echo:channel,Event`               | Public channel                          |
| `echo-private:channel,Event`       | Private channel (requires auth)         |
| `echo-presence:room,joining`       | Presence channel — member joined        |
| `echo-presence:room,leaving`       | Presence channel — member left          |
| `echo-presence:room,here`          | Presence channel — initial member list  |
| `echo:teams.1.threads,MessageSent` | Dot-separated dynamic/nested channel    |
| `echo:scores,.score.submitted`     | Custom `broadcastAs` name (leading dot) |

The part before the comma is the channel name; the part after is the event name. For presence channels, `joining`, `leaving`, and `here` are the built-in presence event names.

### Per-instance channels

A channel that names a record — `issues.417`, `orders.8` — cannot be written as a string. The
decorator's argument is read off the **class**, before any instance exists, so a template literal
inside a plain string is not interpolated: `@on("echo-private:issues.${this.issueId},CommentPosted")`
subscribes to a channel whose name contains those characters, and receives nothing.

Pass a resolver instead. It is called with the component when the snapshot is built, exactly as
[`@presence`](#presence--whos-here-multiplayer) and [`@shared`](#shared-state--everyone-converges-multiplayer)
resolve theirs:

```typescript
export class IssuePage extends Component {
  @locked issue!: Issue;
  @locked comments: Comment[] = [];

  @on((self) => `echo-private:issues.${self.issue.id},CommentPosted`)
  async onCommentPosted(payload: { comment: Comment }): Promise<void> {
    this.comments = [...this.comments, payload.comment];
  }
}
```

The resolver runs once per render, after `onMount()`, so it can read anything the component has
loaded. If it throws — a field it reads is still null, say — that one listener is dropped and the
page renders without it, rather than the render failing.

Resolve the *narrowest* channel the reader is entitled to. A static `issues` channel with an
`if (payload.issueId !== this.issue.id) return` in the handler looks equivalent and is not: the
broadcast still reaches every subscriber's browser, so every reader receives every issue's
comment bodies and discards them after the fact.

### Requirements

Broadcasting requires a global `window.Echo` client configured by your application — the first-party `@zerotal/client` `Socket`, or any compatible realtime client. Flow subscribes through it on component mount and unsubscribes on teardown.

If `window.Echo` is not present, all `echo:` listeners are silently inert — no errors, no subscriptions attempted.

```typescript
// In your frontend bootstrap (app.ts or similar):
import { Socket } from "@zerotal/client";

// The first-party Socket speaks Zerotal's native broadcast protocol and is a
// drop-in for `window.Echo` — no external client library or Pusher credentials.
window.Echo = new Socket();
```

## Presence — who's here (multiplayer)

`@presence` binds a property to a broadcast **presence channel** and keeps it filled with the live member list — the framework joins the channel, seeds the list, and refreshes it as people join and leave. No event classes, no manual `@on` wiring:

```tsx
import { Component, presence } from "@zerotal/flow";
import type { PresenceMember } from "@zerotal/flow";

export class Board extends Component {
  @locked boardId = "";
  // Static channel, or a resolver for a dynamic room:
  @presence((self) => `board.${self.boardId}`) who: PresenceMember[] = [];

  override async render() {
    return (
      <div>
        {this.who.map((m) => (
          <Avatar key={String(m.id)} name={m.name} />
        ))}
      </div>
    );
  }
}
```

The channel is resolved on the server from the component (so it can't be forged from the client) and carried, signed, in the snapshot. `who` is server-controlled (like `@locked`): it lives in the snapshot and the client can't write it. Authorize the channel — and shape the member data — in `routes/channels.ts`:

```ts
Broadcast.channel("board.[boardId]", (user, boardId) =>
  user.canView(boardId) ? { id: user.id, name: user.name } : null,
);
```

**Cursors & typing indicators (ephemeral state).** For high-frequency state that should never hit the server or the database — a cursor position, "is typing" — use `$flow.whisper(event, data)` to broadcast to the other members of the component's presence channel, and `$flow.onWhisper(event, cb)` to receive:

```tsx
<div
  onPointerMove={(e) => $flow.whisper("cursor", { x: e.clientX, y: e.clientY })}
  x-init="$flow.onWhisper('cursor', (p) => renderPeerCursor(p))"
/>
```

Whispers are client-only (they ride the presence channel directly), so they're instant and don't count as component round-trips.

Like all `echo:` features, presence needs a `window.Echo` client configured (above). Without it, `@presence` props stay empty and whispers are inert — no errors.

## Shared state — everyone converges (multiplayer)

Where `@presence` answers _who's here_, `@shared` answers _what do we all see_. It binds a property to convergent, **server-authoritative** state on a channel: mutate it in an action and the framework writes it to a per-channel **room store** and broadcasts to the channel, so every other subscriber re-reads and converges. No store to wire, no events, no dispatch:

```tsx
import { Component, presence, shared, expose } from "@zerotal/flow";

export class Board extends Component {
  @locked boardId = "";
  // The same channel can carry both who's-here and shared state.
  @presence((self) => `board.${self.boardId}`) who: PresenceMember[] = [];
  @shared((self) => `board.${self.boardId}`) cards: Card[] = [];

  @expose addCard(card: Card): void {
    this.cards.push(card); // that's it — written to the room store + broadcast to the channel
  }
}
```

The mental model: a `@shared` prop is a **cache of a server-side room value**, not a per-connection snapshot field. Before every action the prop is refilled from the room store (read-latest), so your action operates on the converged value; after the action, any `@shared` prop it changed is written back and broadcast. Other windows receive the broadcast and re-read — last-write-wins, server-authoritative.

Like `@presence`, the channel is resolved on the server (signed in the snapshot, unforgeable) and the prop is server-controlled (`@locked`): clients render it but change it only through `@expose` actions. Authorize the channel in `routes/channels.ts` exactly as for presence.

Broadcasting is an **optional peer**. With `window.Echo` and `BroadcastProvider` configured, changes fan out to every open window; without them, `@shared` still converges within a single window's own round-trips, because the room store is server-side either way. For multi-instance deployments, swap the in-process store for a shared backend with `setSharedStore(store)` (any `{ get, set, has }`), e.g. Redis-backed — the convergence logic is unchanged.

> v1 semantics are last-write-wins and server-authoritative; `@shared` props should hold plain, serializable data (arrays/objects), like snapshot state generally. The originating window also receives its own change broadcast as an idempotent no-op re-read (self-exclusion is a planned refinement).

## The refresh method

`this.refresh()` re-renders the component and, crucially, re-runs `onMount()` — allowing you to reload data without a full page navigation.

### In a server action

Calling `this.refresh()` inside an action inserts `onMount()` back into the WebSocket round-trip cycle:

```typescript
@expose async syncOrders(): Promise<void> {
  await OrderSync.run();
  this.refresh(); // onMount() re-runs → this.orders is freshly loaded
  this.flash("Orders synced.");
}

@expose async deletePost(id: number): Promise<void> {
  await Post.where("id", id).delete();
  this.refresh(); // reload the posts list
  this.flash("Post deleted.");
}
```

### In a client expression

In the browser, `this.refresh()` sends a lightweight re-render request with no data change — useful for polling or a manual reload button:

```tsx
{
  /* Manual reload button */
}
<button onClick={() => this.refresh()}>Reload</button>;

{
  /* Auto-poll every 30 seconds */
}
<div poll={{ every: "30s", action: this.refresh }}>{/* content refreshes automatically */}</div>;
```

`this.refresh()` inside a `poll` attribute triggers `onMount()` on each poll tick, so the component always shows fresh data without any page navigation.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
