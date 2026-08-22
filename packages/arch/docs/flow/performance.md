---
title: Flow Transport & Performance
description: How updates reach the browser, what to do on hostile networks, and the polish that hides latency.
---

# Transport & performance

Every WebSocket action returns a **patch**. To keep those patches small, Flow sends only what changed:

- **Snapshot deltas.** Instead of re-sending the whole snapshot each round-trip, Flow transmits only the properties that changed (plus any that were removed) and the new signed checksum. The client rebuilds the full snapshot from the copy it already holds. This is exact — the server diffs against the client's own snapshot — and still HMAC-verified, so a large `@locked` collection that doesn't change on a given action isn't re-sent on every keystroke.
- **HTML suppression.** When an action re-renders to markup byte-identical to
  the last patch on that connection, the server omits the HTML entirely and the
  client keeps its DOM — no morph at all. This covers a save that only flashed a
  toast, or a change reflected purely through client-reactive bindings like
  `:class` and `flow:text`.

Both are automatic; there is nothing to configure. What you can still do to help:

- Put display-only collections behind `@transient` (or store IDs and re-load inside the action that needs them) so they never enter the snapshot in the first place.
- Prefer `@computed` for values derivable from other state.
- Reach for client expressions / reactive bindings (`onClick={() => this.open = true}`, `class={…}`) for pure-UI state so those interactions don't round-trip at all.

Set `ZT_FLOW_TRANSPORT_LOG=1` in development to log each patch's delta size versus the full snapshot size (and whether the HTML was suppressed), so you can see the payload of a given interaction while you build.

## WebSocket-blocked networks (HTTP fallback)

Some strict corporate proxies and firewalls block WebSocket upgrades outright — which would otherwise lock those users out of a socket-driven app. Flow has an automatic **circuit breaker**: after a few failed handshakes the client stops waiting on the socket and starts sending action frames over a plain **HTTP POST** to `/__flow/http`. That endpoint runs the _exact same_ server pipeline — hydrate → dispatch →
render → patch — and returns the frames for the client to apply. Actions,
validation, flashes, redirects, and events all keep working, with no code change
in your components.

It's a graceful degrade, not a mode you configure. WebSocket reconnection keeps running in the background, so the moment the socket becomes reachable again the client upgrades back to it automatically. The trade-offs while in fallback:

- Each action is a request/response, with no server-pushed frames — so `@task`
  streaming arrives as one batched update rather than token by token.
- Real-time `@on("socket:…")`, `@presence`, and `@shared` broadcasts are not
  delivered, because those ride the separate broadcasting socket.

Everything driven by your own actions still works. Nothing is sent over HTTP until the socket has actually failed; the happy path is unchanged.

## What forces the runtime fallback

Every page is AOT-compiled at boot where it can be. A page the compiler cannot handle still works —
it renders through the standard runtime instead — and Flow logs a count at startup:

```
N of M Flow pages (75%) render through the runtime fallback instead of compiled output.
```

Set `ZT_FLOW_COMPILE_LOG=1` to print what blocks each page. The common causes:

| Blocker                                                              | Fix                                                |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| `render()` with more than one `return`                               | Build the branches into a variable and return once |
| A function call in a text child — including **`__()`**               | See below                                          |
| An imported child component in `render()` (`<Header/>`)              | Inline it, or accept the fallback                  |
| `class={someLocalConst}` or a numeric-literal attribute (`rows={3}`) | Use a literal string                               |

**`__()` is the one that matters most.** A translated template is a function call in a text child,
so a page that translates a single string falls off the fast path — which in an app where `__()`
is the house style means every page. The cost is normally just speed, but it is not only speed
under [`cspSafe`](/docs/flow/components#csp-safe-mode): there, every page **must** compile or the
build fails, so an app using `__()` in its templates cannot run in CSP-safe mode today. If you need
`cspSafe`, keep translation out of the template — resolve strings in the action or `onMount()` into
`@locked` properties and render those.

## Interaction polish

The perceived speed of a server-driven app comes from three things: never showing
a blank box, never making a click wait to feel like it did something, and never
paying for a navigation you could have paid for during the hover. Flow has a small primitive for each.

### Skeletons

`<Skeleton>` is a pulsing placeholder block — pure markup plus a bundled animation, so it needs no app CSS. Use it for the shape of content that hasn't loaded yet:

```tsx fragment
import { Skeleton } from "@zerotal/flow";

<Skeleton height="1.5rem" width="60%" />     {/* one bar */}
<Skeleton lines={3} />                        {/* three stacked lines, last one short */}
<Skeleton height="10rem" rounded="0.75rem" /> {/* a card-sized block */}
```

The most useful place is a lazy child's `placeholder()` — what shows while the component mounts on viewport entry — and inside a `<Loading>` region (`<Loading skeleton />` renders one for you):

```tsx fragment
export class ChartWidget extends Component {
  override placeholder() {
    return <Skeleton height="12rem" rounded="0.75rem" />;
  }
}

// Parent — the skeleton shows until the widget loads:
<ChartWidget lazy />;
```

Tune the tone with the `--flow-skeleton-color` CSS variable; the pulse respects `prefers-reduced-motion`.

### Optimistic UI with automatic rollback

Because state is a server-authoritative snapshot, optimistic UI and its rollback are already built in. A client expression that changes a prop and then calls an action applies the change **instantly**; when the server responds, the authoritative snapshot reconciles the prop — so if the server **rejects** the change, it snaps back on its own. There is no separate optimistic library and no compensation code to write:

```tsx fragment
@expose liked = false;
@expose confirmLike(): void { /* … persist … */ }

override async render() {
  return (
    <button onClick={() => { this.liked = true; $flow.call("confirmLike"); }}>
      ♥ Like
      <span show={this.liked} class="ml-1 text-rose-600">— saving…</span>
      <span showOnError class="ml-1 text-red-600">— couldn't save</span>
    </button>
  );
}
```

The `showOnError` (and `hideOnError`) directive reveals an element after an action **fails** — an unhandled throw in the action, or an `onUpdating` hook that rejected the optimistic write. It's the failed-state counterpart to `showOnLoading`, and it clears automatically when the next action for that component is dispatched. Rollback itself needs nothing extra: the reconciliation that keeps the client honest also reverts a rejected optimistic value. (Validation errors are not "failures" in this sense — they populate the error bag and drive `error={this.errors.field}` instead.)

### Reactive lists & optimistic collections

Optimistic UI for a scalar is easy (flip a bool, reconcile on the patch). A **list** add/remove is the hard case in server-driven UIs: `{this.items.map(…)}` renders to static server HTML, so pushing to the array client-side wouldn't show until the round-trip. Two pieces solve it.

**`<For>` — a reactive list.** Render the list with `<For>` and it compiles to an Alpine `x-for`, so any client change to the array re-renders it instantly (server patches still keep it authoritative):

```tsx fragment
import { For } from "@zerotal/flow";

<For each={this.todos} keyBy="id">
  {(todo) => (
    <li class={todo.done ? "line-through" : ""}>
      {todo.text}
      <button onClick={() => $flow.call("removeTodo", todo.id)}>×</button>
    </li>
  )}
</For>;
```

The item template supports element structure, static attributes, `class`/`className` (→ reactive `:class`), reactive attributes, `on*` arrow handlers (→ Alpine `@event`, with `this.` resolving to the component), and `{item.field}` text. Anything more exotic → a clear compile error pointing you at a raw Alpine `<template x-for="item in $flow.todos">` escape hatch.

**`appendOptimistic` / `removeOptimistic` — instant add/remove with rollback.** Mutate the array optimistically, then dispatch the action that persists it:

```tsx fragment
<button
  onClick={() => {
    $flow.appendOptimistic("todos", { id: `tmp-${Date.now()}`, text: this.draft });
    $flow.call("addTodo"); // persists + reloads todos
  }}
>
  Add
</button>
```

The item appears the instant you click. Two things then happen to it.

**It survives interim patches.** A broadcast or event landing mid-flight
re-applies your pending change on top of the server state.

**It is reconciled when the owning action's patch lands.** On success the
authoritative server list stands — your persisted row, with its real id. On
failure the server list is unchanged, so the optimistic change rolls back on its
own. Pair it with `showOnError` for a failed-state hint.

Persist the item in that action — push to the `@expose` array, or reload it — so
it stays after reconciliation. `removeOptimistic(prop, (item) => …)` is the
mirror image for deletes.

### Hover-prefetch

Add `hover` to a `navigate` link and Flow fetches the target after a brief hover dwell (and on first touch on mobile), caching the HTML so the click swaps instantly instead of waiting on a cold request:

```tsx fragment
<a href="/posts" navigate hover>
  Posts
</a>;
{
  /* or */
}
<Link href="/posts" hover>
  Posts
</Link>;
```

The cache is small (a handful of recent pages) and short-lived, same-origin only, and never prefetches across a layout boundary. It's the difference between "snappy in dev" and "snappy on 4G."

### Fast refresh in dev

When you edit a component under `serve --dev`, the server restarts (quickly) and the client **re-renders each mounted component from its held snapshot with the new code — keeping its state**, instead of a full reload that would reset everything. Because component state is a signed snapshot and your `APP_KEY` doesn't change across a restart, that snapshot still verifies against the fresh server; the browser also refetches the stylesheet, so a newly-used Tailwind class shows up too. Increment a counter, tweak its template, save — the counter keeps its value and the change appears in place.

Two things to know:

- It deliberately does **not** re-run `onMount`. Editing your data-loading there
  won't reflect until you reload manually — that is the price of preserving
  state.
- If an edit changes a component's shape in a way the held snapshot cannot
  satisfy, Flow falls back to a one-shot full reload rather than showing a
  broken page. Production is unaffected — this only runs under the dev worker.

### Time-travel devtools

Because the engine signs and delta-encodes the **full component state** on every round-trip, the client already holds an exact, verifiable history of everything each component has been. Under `serve --dev`, Flow records that stream: one frame per applied patch,
plus the initial mount. You can then **scrub back to any frame**.

Jumping re-applies that frame's snapshot _and_ its HTML to the live component, so
both state and DOM restore exactly. No setup, no instrumentation in your components.

It surfaces as a **Timeline** tab in the [Zerotal devtools panel](/docs/devtools) (`@zerotal/devtools`) — Flow registers it there so all the framework's tooling lives in one place. If devtools isn't installed, Flow falls back to a standalone ⏱ panel so time-travel still works on its own — docked bottom-left, or set `data-flow-tl-corner="bottom-right"` (any corner) on `<html>` or `<body>` if that clashes with your layout. Each frame shows the action that produced it (`increment`, `$set`, `mount`, …), which state fields changed, and the time. Click a frame to jump there; a **⏵ Resume live** button returns to the latest. It's the fastest way to see how a bug's state evolved — perform the actions, then step backward through them.

There's also a console API for scripted inspection:

```js
__flow.timeline.frames(); // every recorded frame (seq, action, changed fields, snapshot, …)
__flow.timeline.framesFor(id); // frames for one component (its data-flow-id)
__flow.timeline.jump(seq); // restore the component to that frame (state + DOM)
__flow.timeline.live(id); // return a rewound component to its latest frame
```

Two things to know: jumping is **client-only** — it re-applies a snapshot you already hold, with no server round-trip, so it's instant and side-effect-free. State is server-authoritative, though, so acting after a rewind has
consequences: the action sends the rewound snapshot to the server, which
continues authoritatively from there as a coherent new branch.

Use time travel to inspect and replay, then hit **Live** before resuming normal
use. Recording is capped to the most recent frames and runs **only** under the dev worker; production ships none of it.

### Dev error overlay

When an **unexpected** error is thrown, `serve --dev` shows a **full-screen
overlay** carrying the error class, message, and stack. It covers both a server
action and the initial `GET` render (`onMount` / `render`).

That is the same immediacy a client-side bundler gives you, for server-driven
components. The server attaches that detail **only under the dev worker**, so the overlay
never appears in production. No stack is ever sent to a browser there: an action
flashes its message, and an initial-render error returns a normal 500.

The overlay names the **action** and **component** that threw, dims framework/`node_modules` stack frames so your app frames stand out, and dismisses on Esc or a backdrop click. For an action error the component's patch still reconciles underneath, so dismissing returns you to a live page with its state intact — pair it with the [time-travel timeline](#time-travel-devtools) to see exactly how the state got there.

Only genuinely unexpected throws raise the overlay. The framework's own control-flow errors pass straight through to their normal
handling. Validation errors populate the error bag
(`error={this.errors.field}`), and **intended HTTP errors** — an auth `401` or
`403`, a `404`, a redirect — resolve to their proper status instead of a spurious
error screen.

### Durable & resumable state

Fast refresh keeps state across a _dev restart_; **`static durable`** keeps it across a _full client reload_. Opt a component in and its signed snapshot is persisted server-side after every
request, keyed by user (or session) and route.

A multi-step form, a long editor, or any in-progress flow then resumes
**exactly** — whether the user reloads the page, closes and reopens the tab, or
switches device. Nothing is stored in the browser:

```tsx fragment
export class Wizard extends Component {
  static durable = true; // or { ttl: "1h", scope: "user" | "session" }

  @expose step = 1;
  @expose name = "";
  @expose next() {
    this.step++;
  }

  @expose finish() {
    // …persist the result…
    this.clearDurable(); // flow complete — forget the stored snapshot so the next visit is fresh
  }
}
```

How it works: on a fresh `GET`, Flow looks for a valid stored snapshot for this
user and route. Finding one, it restores the snapshot and runs `onHydrate()`
**instead of `onMount()`**.

The resume therefore behaves like a WebSocket round-trip rather than a fresh
load — state comes back from the snapshot, so re-derive any `@transient` model in
`onHydrate()`. If there's no entry — or the snapshot fails its HMAC check (tampered, or your `APP_KEY` rotated) — it mounts fresh. Every subsequent action re-persists the latest snapshot; `this.clearDurable()` drops it.

A few things to know:

- **Keying & isolation.** `scope: "user"` (the default) keys by the authenticated user, falling back to the session when anonymous; `scope: "session"` always keys per-session (per-device, even when logged in). The snapshot is HMAC-signed and keyed by identity, so one user can never resume another's state. A user-scoped component with no user and no session simply doesn't persist.
- **Survives a redeploy — with a persistent store.** The default store is in-process (survives reconnect/tab-close/device-switch within the running process). To also survive a **server restart or redeploy**, swap in a persistent backend — `setDurableStore(store)` accepts any `{ get, set, delete }` (e.g. one backed by `@zerotal/cache`/Redis). Set a `ttl` (default 24h) to bound how long an abandoned flow lingers.
- **The URL vs. the snapshot.** On resume the stored snapshot wins, so `@url` props reflect the saved value rather than re-seeding from the current query string — resume-exactly semantics. Use `clearDurable()` at the natural end of a flow so a returning user isn't dropped back into a finished form.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
