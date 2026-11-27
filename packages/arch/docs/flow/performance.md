---
title: Flow Transport & Performance
description: How updates reach the browser, what to do on hostile networks, and the polish that hides latency.
---

# Transport & performance

Every WebSocket action returns a **patch**. To keep those patches small, Flow sends only what changed:

- **Snapshot deltas.** Instead of re-sending the whole snapshot each round-trip, Flow transmits only the properties that changed (plus any that were removed) and the new signed checksum. The client rebuilds the full snapshot from the copy it already holds. This is exact — the server diffs against the client's own snapshot — and still HMAC-verified, so a large `@locked` collection that doesn't change on a given action isn't re-sent on every keystroke.

  Each delta also names the snapshot it was computed against (its base checksum), and the client applies it only to that snapshot. One action runs at a time per component, so normally the base is always the snapshot the client holds. When an action takes longer than the client's 15-second wait, the client stops waiting but keeps that component's actions queued, and asks the server for the component's whole snapshot (`onMount()` runs again and the full snapshot comes back, not a delta). The queued actions go out once it lands. A late reply whose base no longer matches is set aside the same way rather than applied to the wrong snapshot, which used to rebuild a snapshot that did not verify and leave every later action refused.

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

Some strict corporate proxies and firewalls block WebSocket upgrades outright — which would otherwise lock those users out of a socket-driven app. Flow has an automatic **circuit breaker**: after three refused handshakes, or as soon as the page's first handshake has hung for four seconds (what a proxy that swallows the upgrade looks like, rather than refusing it), the client stops waiting on the socket and starts sending action frames over a plain **HTTP POST** to `/__flow/http`. Actions clicked while it was deciding are sent then, in order. That endpoint runs the _exact same_ server pipeline — hydrate → dispatch →
render → patch — and returns the frames for the client to apply. Actions,
validation, flashes, redirects, and events all keep working, with no code change
in your components.

It's a graceful degrade, not a mode you configure. WebSocket reconnection keeps running in the background, so the moment the socket becomes reachable again the client upgrades back to it automatically. The trade-offs while in fallback:

- Each action is a request/response, with no server-pushed frames — so `@task`
  streaming arrives as one batched update rather than token by token.
- Real-time `@on("socket:…")`, `@presence`, and `@shared` broadcasts are not
  delivered, because those ride the separate broadcasting socket.

Everything driven by your own actions still works. Nothing is sent over HTTP until the socket has actually failed; the happy path is unchanged.

## The client runtime

The browser half of Flow — Alpine, the plugins behind props like `mask` and `trap`, and the
bridge that carries actions over the socket — ships inside `@zerotal/flow` already built. Your
app installs no Alpine and bundles nothing for Flow; the server reads the prebuilt file when it
boots.

Every Flow page ends with two scripts:

```html
<script src="/__flow/routes/3c5e1f2a9b7d4c60.js" defer></script>
<script src="/__flow/assets/runtime.0f73789126a43e14.js" defer></script>
```

The first hands the runtime your app's [named routes](/docs/routing#named-routes), for
`$route(...)`. The second is the runtime. Each file name is a hash of the file's content, so a URL
only ever names one version of a script, and both can be cached for a year
(`max-age=31536000, immutable`). A browser downloads the runtime once and keeps it until you
upgrade Zerotal, and the route table until your routes change.

The runtime is the same for every visitor, so it is sent `public`: a CDN in front of the app can
cache it too. The route table lists your app's routes, so it is sent `private`, and only the
visitor's browser keeps it.

What follows from that:

- **The Alpine version is the one your Zerotal release was built with.** A fix to Alpine reaches
  your app in a Zerotal release, not through `bun update`. If your own code imports `alpinejs` or
  one of its plugins, declare it in your app's dependencies.
- **Turning [`cspSafe`](/docs/flow/components#csp-safe-mode) on or off changes the runtime's
  URL**, because it serves a different build.
- **A binary built by [`bun zt compile`](/docs/deployment#compile-to-a-single-binary) carries the
  runtime inside it.** A compiled Flow app does not serve its pages yet; that page says what a
  binary runs today.
- **A page rendered before a deploy keeps working.** It asks for a hash the new server does not
  have, and is redirected to the current file.

The plain-form enhancement that
[`flowEnhanceTag()`](/docs/flow/forms#enhancing-a-plain-form-no-component) adds is served the same
way, from `/__flow/assets/enhance.<hash>.js`. The URLs these scripts had before they carried a
hash, `/__flow/runtime.js` and `/__flow/enhance.js`, still answer for anything that names them by
hand.

The scripts under `/__flow/assets/` are [raw routes](/docs/routing#raw-routes): they are the same
for every visitor, so your global middleware does not run for them. The route table is an ordinary
route, so your global middleware runs for it exactly as it does for your pages: a visitor it turns
away from the pages does not get the table either.

If your app has global middleware that turns away every request except an allowlist of public
paths, such as a sign-in gate, add `/__flow/*` to that allowlist. Otherwise a public page is
served but its route table is not: `$route(...)` on that page stops working, and so does every
`navigate` link built with it.

## Compiling at boot

Flow compiles your pages' JSX into string-building render functions when the server starts,
not in a build step. It reads each page with the TypeScript compiler API, which is why
`typescript` is a production dependency of `@zerotal/flow` rather than a development one: the
packages ship TypeScript source, so the compile runs on the server that boots the app.

The output is cached in `.zerotal/compiled/`. A boot where no page has changed reads every page
from the cache and never loads the TypeScript compiler, which makes it noticeably faster and
lighter; only a boot with something to compile pays for it. A page is compiled again when:

- its own source changes;
- a module it imports class lists from changes, or the import starts resolving to another file;
- a module a component it uses comes from changes, however deep the component is nested;
- the cached file for it is missing;
- Flow itself is upgraded, or you switch [`cspSafe`](/docs/flow/components#csp-safe-mode) on or off.

You never need to clear the cache by hand. `ZT_FLOW_COMPILE_LOG=1` (below) also bypasses it for
pages that fall back, since it has to compile them to say why.

A binary built by `bun zt compile` compiles its pages while it is built, and boots from what it
carries. See [Compile to a single binary](/docs/deployment#compile-to-a-single-binary).

## What forces the runtime fallback

Every page is AOT-compiled at boot where it can be. A page the compiler cannot handle still works —
it renders through the standard runtime instead — and Flow logs a count at startup:

```
N of M Flow pages (75%) render through the runtime fallback instead of compiled output.
```

The warning appears once more than half of your app's own pages fall back, and counts only
those. Pages a package registers from code, like the admin panel's, render through the runtime by
design and are left out of it. A page your app registers from code, with
`Router.flow("/login", LoginPage)`, is compiled like a file-routed one when its class is exported
from a file under `app/flow/pages/`.

Set `ZT_FLOW_COMPILE_LOG=1` to print what blocks each page. The common causes:

| Blocker                                                                 | Fix                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `render()` with more than one `return`                                  | Build the branches into a variable and return once  |
| A component from a package, or one declared in the page's own file      | See below                                           |
| A component whose own markup does not compile                           | See below                                           |
| A `class` naming an imported constant it could not read                 | Export the constant as a plain string `const`       |
| A `class` given as an array, or a `style={{ … }}` object                | Join the classes into one string; write `style="…"` |
| A class that extends neither `Component` nor a class of yours that does | See below                                           |

A class list kept in a `const` compiles to the literal: one in the same file, or a named import
from a relative module such as `import { CARD } from "../ui"`, on its own, joined with `+`, or
inside a template literal. The compiler reads the value out of the source, so it has to be a plain
string. Any other attribute value — `href={route("login")}`, `data-id={row.id}` inside a `.map()`,
`class={cn(BUTTON, active && "ring-2")}`, `aria-invalid={error ? "true" : undefined}` — is worked
out on the server when the page renders, and written as the runtime would write it: `true` as the
bare attribute, `false` and `undefined` leaving it out, and a URL attribute with its scheme
checked. It needs no client code, so it is legal under `cspSafe` too. A `value` on a `<textarea>`
is the one exception: put the value inside the element instead.

A page can use the app's own function components and stay compiled: a form shared by a create
and an edit page, a page header, an icon. The compiled page calls the component, so what it
renders is exactly what the runtime renders. The compiler reads each one first, through the
page's imports, and calls it only when:

- it is a function exported from one of the app's modules, imported by a relative path. A
  component from a package, or one declared in the page's own file, keeps the page on the
  runtime: move a local one into `app/flow/components/` and import it;
- it returns its markup from one `return`, and that markup compiles under the same rules as a
  page's, with nothing but its props to read. It may use other components on the same terms;
- it holds no event handler and no directive that takes a value (`show=`, `model=`, `text=`).
  Those are client code, which `cspSafe` has to see in the page itself. Put them on the page's
  own elements and pass the component values;
- the page passes it values, not functions, and does not pass a field of its own as `value=`,
  `checked=`, `show=` or `text=`: on the runtime that becomes a binding to the field, and from
  compiled output it would not.
- it places its children as `{children}` in its markup, hands them on (`{open && children}`), or
  tests whether it has any. A compiled page hands them over in the shape the runtime does, with
  markup already rendered, so a component that uses them as a value, `aria-label={children}`
  under any name, keeps the page on the runtime.

A component that fails one of these names itself in the `ZT_FLOW_COMPILE_LOG=1` output, with the
line in its own file that stopped it.

A page can extend a class of your own instead of `Component`, to share what every page needs (a
head, a layout, reading the signed-in user), as long as that class is imported from a relative
module and extends `Component` itself, or through another such class. Its `@expose` and `@locked`
fields count as the page's own.

A function call in a text child compiles too, when it starts from code that is not the app's and
is handed only data: `{__("projects.title", { count: this.count })}` from `zerotal/i18n`,
`{CsrfMiddleware.field()}`, a date library's formatter, or `{String(n).padStart(3, "0")}`, at the
top of the markup, in a ternary branch or inside a `.map()`. It runs on the server as the page
renders, and its result is written the way the runtime writes a child: an array item by item,
`null`, `undefined` and booleans as nothing, and anything else escaped. It needs no client code, so
a page that translates its strings with `__()` compiles under
[`cspSafe`](/docs/flow/components#csp-safe-mode).

- **Where it starts.** A function, class or namespace imported from a package: a framework package
  other than Flow's own, or one that resolves into `node_modules` and does not itself depend on
  Flow. A path alias or a workspace package is the app's code. Or one of these globals: `String`,
  `Number`, `Boolean`, `Math`, `JSON`, `Date`, `Intl`, `parseInt`, `parseFloat`, `encodeURI`,
  `encodeURIComponent`, `isNaN` and `isFinite`, when nothing in the file declares that name.
- **What it is handed.** Every argument along the chain is data: literals, the page's fields
  declared with no initializer or a plain literal one, locals the render computed from data, and
  calls that pass the same rule. A function, a method of the page,
  one of the app's functions, or a callback's parameter handed to a package's call could be called
  back by it, so any of those keeps the page on the runtime.

The app's own code can return markup by any route, and markup needs the render context for its
bindings and for any class component in it. So any other call keeps the page on the runtime, and
the compile log says why. For a value from your own code, compute it in a leading const
(`const due = formatDate(project.dueOn);`) and render the const; for markup, render a component
(`<Badge />`). A call that awaits (`{format(await load())}`) or is handed markup
(`{wrap(<b>hi</b>)}`) stays on the runtime too.

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

Add `navigateHover` to a `navigate` link (or `hover` to a `<Link>`) and Flow fetches the target after a brief hover dwell (and on first touch on mobile), caching the HTML so the click swaps instantly instead of waiting on a cold request:

```tsx fragment
<a href="/posts" navigate navigateHover>
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

When you edit a component under `zt dev`, the server restarts (quickly) and the client **re-renders each mounted component from its held snapshot with the new code — keeping its state**, instead of a full reload that would reset everything. Because component state is a signed snapshot and your `APP_KEY` doesn't change across a restart, that snapshot still verifies against the fresh server; the browser also refetches the stylesheet, so a newly-used Tailwind class shows up too. Increment a counter, tweak its template, save — the counter keeps its value and the change appears in place.

Two things to know:

- It deliberately does **not** re-run `onMount`. Editing your data-loading there
  won't reflect until you reload manually — that is the price of preserving
  state.
- If an edit changes a component's shape in a way the held snapshot cannot
  satisfy, Flow falls back to a one-shot full reload rather than showing a
  broken page. Production is unaffected — this only runs under the dev worker.

### Time-travel devtools

Because the engine signs and delta-encodes the **full component state** on every round-trip, the client already holds an exact, verifiable history of everything each component has been. Under `zt dev`, Flow records that stream: one frame per applied patch,
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

When an **unexpected** error is thrown, `zt dev` shows a **full-screen
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
