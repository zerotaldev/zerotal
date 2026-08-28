---
title: Flow Reference
description: Every decorator, prop, directive, and client global in one table.
---

# References

Quick reference for all Flow JSX props, client expressions, and decorator combinations.

## Commands

`@zerotal/flow` ships one generator:

| Command                    | What it does                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| `bun zt make:flow Counter` | Create a Flow page or child component (`--child`, `--crud`, `--layout`, `--dir`) |

## JSX props reference

Write these as ordinary JSX attributes. The right-hand column shows what each compiles to, for when you're inspecting rendered HTML.

### Event binding

| You write                  | Behaviour                                       | Compiles to                    |
| -------------------------- | ----------------------------------------------- | ------------------------------ |
| `onClick={this.method}`    | Server action on click (round-trip)             | `flow:click="method"`          |
| `onClick={() => this.x++}` | Client expression, no round-trip                | `flow:click="() => $flow.x++"` |
| `onSubmit={this.method}`   | Server action on submit (auto-prevents default) | `flow:submit="method"`         |
| `onChange={this.method}`   | Server action on change                         | `flow:change="method"`         |
| `onInput={this.method}`    | Server action on input                          | `flow:input="method"`          |
| `onKeydown={this.method}`  | Server action on keydown                        | `flow:keydown="method"`        |

### Two-way binding

| You write                 | Behaviour                                         | Compiles to               |
| ------------------------- | ------------------------------------------------- | ------------------------- |
| `value={this.x}`          | Two-way bind (`@expose`) or read-only (`@locked`) | `flow:model="x"`          |
| `checked={this.x}`        | Two-way checkbox bind                             | `flow:model="x"`          |
| `value={this.x} live`     | Sync to server on each keystroke                  | `flow:model.live="x"`     |
| `value={this.x} blur`     | Sync to server on blur                            | `flow:model.blur="x"`     |
| `value={this.form.field}` | Nested form field binding                         | `flow:model="form.field"` |

### Validation

| You write                   | Behaviour                         | Compiles to          |
| --------------------------- | --------------------------------- | -------------------- |
| `error={this.errors.field}` | Reactive first validation message | `flow:error="field"` |

### Reactive attributes

| You write                    | Behaviour                                  | Compiles to     |
| ---------------------------- | ------------------------------------------ | --------------- |
| `className={cond ? a : b}`   | Reactive class, updates without round-trip | `:class="…"`    |
| `class={cond ? a : b}`       | Same as `className`                        | `:class="…"`    |
| `style={{ color: this.x }}`  | Reactive inline style                      | `:style="…"`    |
| `href={"/posts/" + this.id}` | Reactive attribute                         | `:href="…"`     |
| `disabled={this.saving}`     | Reactive boolean attribute                 | `:disabled="…"` |

### Loading states

Visual loading indicators (`showOnLoading`, `hideOnLoading`, `loadingClass`) wait out a short delay (~200ms) so a fast action never flashes them; `loadingAttr` is applied immediately (double-click guard).

| You write                    | Behaviour                                                       | Compiles to                     |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------- |
| `loadingAttr="disabled"`     | Sets `disabled` immediately while an action is in flight        | `flow:loading.attr.disabled`    |
| `showOnLoading`              | Shows element while an action is in flight (after the delay)    | `flow:loading`                  |
| `hideOnLoading`              | Hides element while an action is in flight (after the delay)    | `flow:loading.remove`           |
| `loadingClass="opacity-50"`  | Adds class while loading (after the delay)                      | `flow:loading.class.opacity-50` |
| `loadingTarget="save"`       | Scope the loading state to specific action(s) (comma-separated) | `flow:target`                   |
| `loadingTargetExcept="poll"` | Scope loading to every action **except** these                  | `flow:target.except`            |
| `showOnDirty`                | Shows element when local state differs from server snapshot     | `flow:dirty`                    |
| `hideOnDirty`                | Hides element when local state is dirty                         | `flow:dirty.remove`             |
| `showOnError`                | Shows element after an action fails (optimistic failed state)   | `flow:failed`                   |
| `hideOnError`                | Hides element after an action fails                             | `flow:failed.remove`            |

### Visibility and control

| You write                 | Behaviour                                       | Compiles to        |
| ------------------------- | ----------------------------------------------- | ------------------ |
| `show={this.flag}`        | Reactive show/hide off a boolean prop           | `flow:show="flag"` |
| `confirm="Are you sure?"` | Browser confirm gate before the action fires    | `flow:confirm`     |
| `cloak`                   | Hidden until Alpine initialises (prevents FOUC) | `x-cloak`          |

### Navigation props

| You write         | Behaviour                                                 | Compiles to                         |
| ----------------- | --------------------------------------------------------- | ----------------------------------- |
| `navigate`        | SPA navigation to `href`, layout stays mounted            | `flow:navigate`                     |
| `navigate hover`  | Prefetch page on hover (~60ms debounce)                   | `flow:navigate flow:navigate.hover` |
| `navigate down`   | Prefetch page on pointer-down (no dwell; dense lists)     | `flow:navigate flow:navigate.down`  |
| `current={false}` | Disable automatic `data-current` attribute                | —                                   |
| `exact`           | `data-current` only on an exact URL match (not sub-pages) | `flow:current.exact`                |

### Polling

| You write                                   | Behaviour                                     | Compiles to |
| ------------------------------------------- | --------------------------------------------- | ----------- |
| `poll={{ every: "5s", action: this.tick }}` | Call action on an interval                    | `flow:poll` |
| `poll={{ every: "30s" }}`                   | Re-render on an interval (no specific action) | `flow:poll` |

### Streaming props

| You write      | Behaviour                                        | Compiles to         |
| -------------- | ------------------------------------------------ | ------------------- |
| `stream="ref"` | Target element for `this.stream("ref", content)` | `flow:stream="ref"` |

### Intersection and visibility

| You write                   | Behaviour                                        | Compiles to      |
| --------------------------- | ------------------------------------------------ | ---------------- |
| `onIntersect={this.method}` | Call action when the element enters the viewport | `flow:intersect` |

### Offline states

The client keeps a live WebSocket; when it drops (and while it reconnects with exponential back-off), Flow flips `body[data-flow-connection]` to `offline` and the props below react. Actions taken while offline are queued and replayed in order on reconnect, so the UI keeps working through a blip.

| You write                   | Behaviour                                     | Compiles to           |
| --------------------------- | --------------------------------------------- | --------------------- |
| `showOnOffline`             | Show the element while the connection is down | `flow:offline`        |
| `hideOnOffline`             | Hide the element while the connection is down | `flow:offline.remove` |
| `offlineClass="opacity-50"` | Add a class while offline                     | `flow:offline.class`  |
| `offlineAttr="disabled"`    | Set an attribute while offline                | `flow:offline.attr`   |

#### Recovering from a drop mid-action

If the connection drops while an action is in flight, the client cannot tell whether it ran. The server is stateless per frame, so a completed action has already committed its database write — while the browser is still holding the state from before it. Guessing either way is wrong: replaying risks doing the work twice, discarding loses it.

So Flow re-derives instead. Any component left mid-action is refreshed from the server on reconnect (`onMount()` runs again and a fresh patch comes back), which lands on the truth whether the action ran or not. The same applies when an acknowledgement simply times out.

The refresh is announced first, so you can say something rather than have the UI change under the user:

```ts fragment
document.addEventListener("flow:desync", (e) => {
  const { components } = (e as CustomEvent<{ components: string[] }>).detail;
  toast(`Reconnected — refreshing ${components.length} component(s).`);
});
```

### Transitions

| You write    | Behaviour                                                   | Compiles to       |
| ------------ | ----------------------------------------------------------- | ----------------- |
| `transition` | Fade/slide the element in when the morph adds it to the DOM | `flow:transition` |

Tune the duration with the `--flow-transition-duration` CSS variable (default `200ms`).

### Drag-and-drop reordering

Mark a container with `onSort` (the reorder action) and each child with `sortItem` (its stable key). Dragging a child calls the action as `reorder(key, newIndex)` on drop.

| You write               | Behaviour                                                | Compiles to        |
| ----------------------- | -------------------------------------------------------- | ------------------ |
| `onSort={this.reorder}` | Reorder action on the container — `(key, index)`         | `flow:sort`        |
| `sortItem="id"`         | Stable key of a draggable child                          | `flow:sort:item`   |
| `sortHandle`            | Restrict the drag grip to this element                   | `flow:sort:handle` |
| `sortIgnore`            | Exclude this child from dragging/reordering              | `flow:sort:ignore` |
| `sortGroup="tasks"`     | Allow dragging between containers sharing the group name | `flow:sort:group`  |

```tsx fragment
@expose async reorder(key: string, index: number) {
  const moved = this.items.find((i) => String(i.id) === key);
  if (!moved) return;
  this.items = this.items.filter((i) => i !== moved);
  this.items.splice(index, 0, moved);
  await this.persistOrder();
}

override async render() {
  return (
    <ul onSort={this.reorder}>
      {this.items.map((it) => (
        <li key={String(it.id)} sortItem={String(it.id)}>{it.name}</li>
      ))}
    </ul>
  );
}
```

> A dynamic `sortItem={String(it.id)}` inside a `.map()` renders through the standard runtime (not the AOT fast path) — the drag behaviour is identical either way.

> **The payload does not say which container took the drop.** The client reads `flow:sort` off the
> container a child was dropped **into** and calls it `(key, index)` — so the destination is
> encoded in _which method runs_, and nowhere else. For a single sortable list that is invisible.
> For dragging **between** containers under one `sortGroup` it means one action per container:
>
> ```tsx
> <ul onSort={this.dropInTodo} sortGroup="tasks">…</ul>
> <ul onSort={this.dropInDone} sortGroup="tasks">…</ul>
> ```
>
> An arrow (`onSort={(k, i) => this.move("todo", k, i)}`) cannot stand in, because the attribute's
> value is used as a method _name_ rather than evaluated. `onSort` accepts the name as a string,
> so the handlers can come from a lookup table keyed by column, but they must be declared members.

### DOM utilities

| You write         | Behaviour                                                    | Compiles to     |
| ----------------- | ------------------------------------------------------------ | --------------- |
| `teleport="body"` | Move the element to a CSS selector target (modals, tooltips) | `flow:teleport` |
| `ref="name"`      | Name this element as `$refs.name` for ``this.$`…` `` scripts | `x-ref`         |

### Alpine plugins

| You write                | Behaviour                                 | Compiles to  |
| ------------------------ | ----------------------------------------- | ------------ |
| `mask="(999) 999-9999"`  | Format an input as the user types         | `x-mask`     |
| `trap="$flow.open"`      | Trap focus while the expression is truthy | `x-trap`     |
| `collapse`               | Animate `x-show` with a height transition | `x-collapse` |
| `anchor="$refs.trigger"` | Float relative to another element         | `x-anchor`   |

### Escape hatch

| You write                                | Behaviour                                                    |
| ---------------------------------------- | ------------------------------------------------------------ |
| `x-text="$flow.count"`                   | Raw Alpine attribute using live client state via `$flow`     |
| `x-show="$flow.open && $flow.count > 0"` | Raw Alpine expression                                        |
| `flow:click="increment"`                 | Hand-written Flow directive (accepted but not needed in JSX) |

## Plain-form enhancement

For forms on pages with no Flow component. See
[Forms](/docs/flow/forms#enhancing-a-plain-form--no-component).

| Attribute / export    | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `data-enhance`        | Submit through `fetch` and patch the response in. `"false"` opts out.                  |
| `data-enhance-target` | CSS selector for what to replace, instead of the form itself.                          |
| `data-enhance-busy`   | Set on the form while a submission is in flight. Styling hook and re-entry guard.      |
| `flowEnhanceTag()`    | The `<script>` tag to put in a non-Flow layout.                                        |
| `FLOW_ENHANCE_PATH`   | `/__flow/enhance.js` — the path the bundle is served at.                               |
| `flow:enhanced`       | Window event after each swap; `detail.navigated` says whether a redirect was followed. |

## Client expressions

Inside a client expression — `onClick={() => this.X(...)}` — `this.` resolves to the live client runtime (no server round-trip to start it). You write the **same names as on the server** — no `$`-prefixed syntax, and it all type-checks.

### State manipulation

| Expression               | Behaviour                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `this.count++`           | Write to an `@expose` prop — updates the DOM instantly, then syncs so `render()` reflects it |
| `this.open = true`       | Set any `@expose` prop; `@locked` props are read-only                                        |
| `this.filter = "active"` | Works with any primitive value                                                               |

A write syncs to the server after the expression finishes, unless the same expression also calls a server action (that action's round-trip already carries it) or the value ends back where it started. Client-only UI state belongs in [`this.store()`](#global-client-store), which never round-trips.

### Querying state

| Expression          | Behaviour                            |
| ------------------- | ------------------------------------ |
| `this.count > 10`   | Read any `@expose` or `@locked` prop |
| `this.user.name`    | Nested property access               |
| `this.posts.length` | Array methods and properties         |

### Navigation props and lifecycle

| Expression                              | Behaviour                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `this.refresh()`                        | Request a fresh server render of this component                                         |
| `this.currentUrl({ query, hash })`      | Build a URL from the current one with merged query params (no navigation) — client-only |
| `this.navigateCurrent({ query, hash })` | Build that URL and SPA-navigate to it — client-only                                     |

`currentUrl()` / `navigateCurrent()` merge query params onto the current URL: listed params are added/updated, unlisted ones preserved, and a `null`/`undefined`/`""` value removes a param. Use `currentUrl()` in a binding (`href={this.currentUrl({ query: { page: this.page + 1 } })}`) and `navigateCurrent()` in a handler (`onChange={(e) => this.navigateCurrent({ query: { status: e.target.value || null } })}`). Both are client-only — they throw if called from server code. See [Query-aware navigation](/docs/flow/routing#query-aware-navigation).

### Event dispatch

| Expression                                        | Behaviour                                   |
| ------------------------------------------------- | ------------------------------------------- |
| `this.dispatch("event", data)`                    | Dispatch to every component on the page     |
| `this.dispatchTo("ComponentName", "event", data)` | Dispatch only to a specific component class |
| `this.dispatchSelf("event", data)`                | Dispatch only to this component             |

### Parent interaction

| Expression                  | Behaviour                                          |
| --------------------------- | -------------------------------------------------- |
| `$flow.parent.method(args)` | Invoke an action on the nearest ancestor component |
| `$flow.parent.prop`         | Read an exposed property of the parent             |

### Global client store

| Expression                | Behaviour                                                       |
| ------------------------- | --------------------------------------------------------------- |
| `$flow.store.ui.dark`     | Read a value from the global client store (reactive)            |
| `$flow.store.ui.dark = …` | Write it — every component reading it re-renders, no round-trip |

`$flow.store` is app-wide UI state that shouldn't round-trip to the server — side-panel visibility, colour scheme, notification drawer, etc. Declare its shape with `defineStore(...)` at app start and type it by augmenting `FlowStore` (see [The global client store](/docs/flow#the-global-client-store)):

```tsx fragment
<button onClick={() => ($flow.store.ui.sidebarOpen = true)}>Open sidebar</button>
<aside show={$flow.store.ui.sidebarOpen}>Sidebar content</aside>
```

## Decorator quick reference

| Decorator                            | On       | Effect                                                         |
| ------------------------------------ | -------- | -------------------------------------------------------------- |
| `@expose`                            | property | Synced to client; client can mutate via `value=` or expression |
| `@expose`                            | method   | Callable from browser via WebSocket                            |
| `@locked`                            | property | Synced to client for display; client cannot change it          |
| `@validate((rule) => rule.…)`        | property | Auto-validated by `this.validate()`; live on `flow:model.live` |
| `@url`                               | property | Synced to URL query string (`?prop=value`)                     |
| `@url({ as: "p", history: "push" })` | property | Custom param name; push history entry                          |
| `@session`                           | property | Persisted in HTTP session across page loads                    |
| `@computed`                          | getter   | Derived from state; memoized per render pass; not in snapshot  |
| `@transient`                         | property | Excluded from snapshot; reset on every round-trip              |
| `@renderless`                        | method   | Runs server-side but skips re-render                           |
| `@on("event")`                       | method   | Listens for cross-component events (auto-exposed)              |
| `@reactive`                          | property | Child prop the parent can re-push on change                    |
| `@modelable`                         | property | Two-way child prop (parent↔child sync)                         |

## Lifecycle hook quick reference

| Hook                    | `GET` (initial) | `WebSocket` (subsequent)        |
| ----------------------- | --------------- | ------------------------------- |
| `onBoot()`              | ✓               | ✓                               |
| `onMount()`             | ✓               | only if `this.refresh()` called |
| `onHydrate()`           | —               | ✓                               |
| `onUpdating(prop, val)` | —               | ✓ (per client write)            |
| `onUpdated(prop, val)`  | —               | ✓ (per client write)            |
| `action()`              | —               | ✓                               |
| `onUpdate()`            | —               | ✓                               |
| `onRendering()`         | ✓               | ✓                               |
| `render()`              | ✓               | ✓                               |
| `onRendered(html)`      | ✓               | ✓                               |
| `onDehydrate()`         | ✓               | ✓                               |
| `onError(error)`        | —               | ✓ (on throw)                    |

## FlowTest assertion reference

| Method                          | Asserts                                      |
| ------------------------------- | -------------------------------------------- |
| `t.assertSee(text)`             | Rendered HTML contains `text`                |
| `t.assertDontSee(text)`         | Rendered HTML does NOT contain `text`        |
| `t.assertHasErrors(field)`      | Validation error exists for `field`          |
| `t.assertHasErrors(field, msg)` | Error for `field` contains `msg`             |
| `t.assertNoErrors()`            | No validation errors                         |
| `t.assertRedirectedTo(url)`     | Last action redirected to `url`              |
| `t.assertNotRedirected()`       | Last action did not redirect                 |
| `t.assertFlashed(level?, msg?)` | Flash notification was emitted               |
| `t.assertDispatched(event)`     | Cross-component event was dispatched         |
| `t.page()`                      | The component instance                       |
| `t.html()`                      | Rendered HTML string                         |
| `t.errors()`                    | Error bag: `Record<string, string[]>`        |
| `t.effects()`                   | Drained effects (flashes, redirects, events) |
| `t.snapshot()`                  | Serialised snapshot                          |
