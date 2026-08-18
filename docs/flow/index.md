---
title: Flow
description: Build reactive, server-driven UIs as plain TypeScript classes — no API layer, no client store, no hand-written reactivity.
---

# Flow

Flow is Zerotal's server-driven UI layer. Each component is a TypeScript class that lives on the server. Decorators expose state and actions to the browser over a WebSocket; the client applies morphing patches without a full page reload. No API layer, no client-side store, no hand-written reactivity — the server is the source of truth.

**You write plain JSX and Flow takes care of the rest.** Bind a handler with `onClick={this.save}`, two-way an input with `value={this.name}`, show a validation message with `error={this.errors.email}`. There is no `flow()` wrapper, no `this.bind(...)`, and no manual `flow:*` attributes in your components — Flow's compiler reads the shape of each prop and emits the right directive for you.

## Getting Started

### How it works

1. A `GET` request renders the page on the server, serialises its state into a signed snapshot embedded in the HTML, and streams the result.
2. The browser restores the page from the snapshot. User interactions (clicks, input changes, navigation) are sent as WebSocket frames to the server.
3. The server hydrates the page from the snapshot, runs the action method, re-renders, and diffs the output. Only the changed DOM patches are sent back and morphed in.

This means your component code runs exclusively on the server. There's no bundler step for your application logic, no client hydration mismatch, and the browser never receives your business logic.

### Installation

```bash
# in your project root
bun add @zerotal/flow
```

### Register the provider

Add `FlowProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { FlowProvider } from "@zerotal/flow";

const providers = [
  // …your other providers
  FlowProvider,
];

export default providers;
```

Registering the provider switches on the following (in lifecycle order):

- `onRegister` — registers the `Router.flow()` macro and the file-route resolver so Flow pages can be declared and auto-discovered.
- `onBooting` — builds the client runtime bundle (Alpine + the Flow bridge) and mounts the routes under `/__flow` (the WebSocket endpoint, `runtime.js`, the upload endpoint, and the session-relay endpoint).
- `onBooted` — wires `serve --dev` rebuild hooks for `resources/css/app.css` and `resources/js/app.js` (a no-op when those entry points are absent).
- `onStarting` — AOT-compiles and validates every registered page's `render()` method.

### Configuration

Flow runs with no configuration at all. Add `config/flow.ts` only when you want to
change one of its two knobs — the file is auto-discovered, and every key you leave
out keeps its default:

```typescript
// config/flow.ts
import { FlowConfig } from "@zerotal/flow";

export default FlowConfig({
  cspSafe: true,
});
```

| Key                    | Default                                                                   | Controls                                                                                       |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `cspSafe`              | `false`                                                                   | Serve the eval-free client runtime — see [CSP-safe mode](/docs/flow/components#csp-safe-mode). |
| `persistentMiddleware` | `["SessionMiddleware", "PersistUserMiddleware", "BearerTokenMiddleware"]` | Which **global** middleware re-runs on every WebSocket update.                                 |

`cspSafe` also reads the `ZT_FLOW_CSP_SAFE` (or `APP_CSP_SAFE`) env flag when no
config file sets it, so an existing env-driven deployment keeps working untouched.

### What re-runs on a WebSocket action

A Flow action is not an HTTP request, so the pipeline is rebuilt for each one:

- **Route middleware re-runs in full, automatically.** Anything attached to the
  page's route — `Router.flow("/admin", Page, [AuthMiddleware])`, a surrounding
  `Router.group`, or a `_middleware.ts` in the file-route tree — is re-applied on
  every action. There is nothing to declare, and this is where most app middleware
  lives.
- **Global middleware re-runs only if listed.** Most of the global pipeline exists
  to shape an HTTP request/response that a WebSocket frame does not have: CORS and
  security headers decorate a response, CSRF guards a form post the snapshot HMAC
  already authenticates, and a request logger would fire on every keystroke. The
  three defaults are the ones that establish _identity_ — session, user, bearer
  token — which the action genuinely needs.

Because Flow pages are file-routed by default, the natural place for shared
middleware is a `_middleware.ts` in the page tree. It stacks from the root down,
covers every page beneath it, and — being route middleware — re-runs on every
action with nothing else to configure:

```typescript
// app/flow/pages/_middleware.ts
import { TenantMiddleware } from "../../middleware/TenantMiddleware.ts";

export const middleware = [TenantMiddleware];
```

Scope it to part of the tree with a `(group)` directory — `(protected)/_middleware.ts`
guards the pages inside it without changing their URLs. See
[Directory middleware](/docs/routing#directory-middleware).

Reach for `persistentMiddleware` only when the middleware is genuinely **global** —
registered app-wide with `Application.use()` because non-Flow routes need it too:

```typescript
// app/providers/AppServiceProvider.ts — inside onRegister():
FlowProvider.persistMiddleware(TenantMiddleware);
```

> **Warning** — Setting `persistentMiddleware` in `config/flow.ts` **replaces** the
> whole list, so include the three defaults alongside your own or WebSocket actions
> lose the session and the signed-in user. `persistMiddleware()` appends, which is
> why it is the safer way to add one.

Point the JSX transform at Flow in `tsconfig.json`. Set it once and every `.tsx`
component in the project is covered — the Flow scaffold already writes this:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@zerotal/flow"
  }
}
```

> **Note** — A project that mixes runtimes (Flow components alongside React or
> Vue Inertia pages) can only set one of these globally. Files on the other
> runtime need a `/** @jsxImportSource … */` comment of their own — which is why
> `make:flow` writes one into every class it generates.

> **Note** — Flow components and `zerotal/view` components do not interoperate, and the failure
> is a type error rather than a wrong render. The two JSX runtimes produce different element
> types: a view `FC` returns `SafeHtml` (`{ value }`) and Flow's JSX expects `HtmlNode`
> (`{ html }`), so using one inside the other is `TS2786: 'Box' cannot be used as a JSX
> component`. A shared component library has to target one runtime; share class-name constants
> or plain strings across the two instead of components.

### Your first component

```tsx
import { Component, expose } from "@zerotal/flow";

export class CounterPage extends Component {
  @expose count: number = 0;

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <p>Count: {this.count}</p>
        <button onClick={this.increment}>+</button>
        <button onClick={() => this.count--}>−</button>
      </div>
    );
  }
}
```

`onClick={this.increment}` is a **server action** — it round-trips over the WebSocket, runs `increment()` on the server, and patches only the changed DOM nodes back. `onClick={() => this.count--}` is a **client expression** — it updates the DOM instantly with no round-trip.

The distinction is the syntax: a named method reference is always a server action; an arrow function is always a client expression. You express the distinction the same way you would in React.

Register the route:

```typescript
// routes/web.ts
import { Router } from "zerotal";
import { CounterPage } from "./components/CounterPage.tsx";

Router.flow("/counter", CounterPage);
```

### Reserved member names

`Component` brings its own members, and a property of yours that collides with one is a
type error. It is caught at compile time and the message is specific, but the name that
trips people is `title` — an obvious field for a row representing a media item, a guide or
a review, and taken by the page-title accessor.

The names in use:

| Group             | Names                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lifecycle         | `onBoot` `onMount` `onHydrate` `onDehydrate` `onRendering` `onRendered` `onUpdate` `onUpdating` `onUpdated` `onError` |
| Rendering         | `render` `layout` `placeholder` `slot` `hasSlot` `child` `title`                                                      |
| Actions & state   | `bind` `validate` `resetValidation` `errors` `addError` `refresh` `$refresh` `$set` `cancelled` `signal`              |
| Navigation        | `redirect` `redirectRoute` `redirectIntended` `currentUrl` `navigateCurrent`                                          |
| Events & realtime | `dispatch` `dispatchSelf` `dispatchTo` `stream` `client`                                                              |
| Misc              | `flash` `download` `clearDurable`                                                                                     |

Anything beginning with `_` is also framework-internal, as is the static `durable`.

If the natural name is taken, the usual fix is a more specific one — `headline`,
`mediaTitle` — which often reads better than `title` did.

### Scaffolding with make:flow

You don't have to write each component from a blank file. `make:flow` generates a ready-to-run class with the JSX pragma, the right imports, and an `@expose`/`render` skeleton already in place:

```bash
bun zt make:flow Dashboard             # a page under app/flow/pages
bun zt make:flow Users/Index --crud    # a resourceful page: list + create/edit/delete + validation
bun zt make:flow StarRating --child    # a child component (props from its parent)
bun zt make:flow Billing --layout AppLayout   # a page wrapped in a layout
```

The name may be nested (`Users/Index` → `app/flow/pages/Users/Index.tsx`), and the target directory is auto-detected (`app/flow/pages` for pages, `app/flow/components` for children) or set with `--dir`. Because Flow uses file-based routing, a generated page is served automatically — the command also prints the explicit `Router.flow(...)` line for apps that register routes by hand.

The command lives on `FlowProvider`, so it's available in any app that registers the provider. (If `make:flow` isn't found, add `FlowProvider` to your `bootstrap/providers.ts` — an app that only pulls it in transitively through the admin panel won't have it in CLI runs.)

### Server actions vs. client expressions

| Syntax                              | Behaviour                                          | Round-trip              |
| ----------------------------------- | -------------------------------------------------- | ----------------------- |
| `onClick={this.save}`               | Calls `save()` on the server, re-renders           | Yes                     |
| `onClick={() => this.count++}`      | Updates `count` in the browser instantly           | Yes, after (state sync) |
| `onSubmit={this.register}`          | Calls `register()` on the server, prevents default | Yes                     |
| `onClick={() => this.open = false}` | Sets `open` in the browser instantly               | Yes, after (state sync) |

Client expressions read and write the same `@expose` properties your server sees. Assigning to an `@expose` property from a client expression updates the UI immediately, then syncs to the server, which re-renders with the new value — so anything `render()` derives from that property (a selected row's detail, a conditional branch) reflects the write without needing a separate action. The sync is skipped when the same expression also calls a server action (that action's round-trip already carries the write), and when the write leaves the value back where it started. `@locked` properties are read-only on the client.

State that the server should never see — a hover flag, which accordion section is open — belongs in the [global client store](#the-global-client-store) (`this.store()`), which is client-only and never round-trips.

### Passing arguments to a server action

A list with per-row actions needs to tell the server _which_ row. Write the call as you would expect, and Flow compiles the arguments into the markup:

```tsx
{
  this.enquiries.map((row) => (
    <tr>
      <td>{row.reference}</td>
      <td>
        <button onClick={() => this.archive(row.id)}>Archive</button>
      </td>
    </tr>
  ));
}
```

The arguments are evaluated **on the server, during the render** — where `row` exists — and travel with the action as `data-args`. Your action receives them as ordinary parameters:

```ts
@expose async archive(id: number) {
  await Enquiry.findOrFail(id).archive();
}
```

You can also write `data-args` yourself, which is useful when the handler is built dynamically:

```tsx
<button onClick={this.archive} data-args={JSON.stringify([row.id])}>
  Archive
</button>
```

::: warning Arguments are evaluated once, at render time
An argument that reads `this` is **not** frozen — `onClick={() => this.setPage(this.page + 1)}` stays a live client expression and re-evaluates in the browser against current reactive state. Only arguments that close over server-side values (a loop variable, a computed local) are serialised.

Anything else a client expression references must exist in the browser. A handler that reaches for an enclosing server-side variable outside a call — `onClick={() => (window.location = row.url)}` — is reported at boot, naming the identifier, because it would otherwise be emitted verbatim and throw a `ReferenceError` in the browser, where nothing surfaces it. The page falls back to the runtime renderer rather than failing the build, since the check works from a known list of globals and a false positive should not stop your server starting. Under `cspSafe`, where there is no runtime fallback, it is fatal.

By contrast, a handler pointing at a method you forgot to `@expose` **is** a hard error — that one is certain, not heuristic, and the alternative is a button that silently does nothing.
:::

### Two-way inputs

Bind an input by passing state straight to `value` (or `checked`). Flow wires up two-way binding when the property is `@expose`, and read-only reflection when it's `@locked`:

```tsx
<input value={this.name} />                          {/* @expose → two-way    */}
<input type="checkbox" checked={this.agree} />        {/* @expose → two-way    */}
<input value={this.ownerName} />                      {/* @locked → read-only  */}
```

A **radio group** is bound as a unit rather than per input, because every option writes the same property. Pass the option's own value as a second argument to `bind()`:

```tsx
{
  ["CUSTOM", "ROUTE", "TEAMS"].map((t) => (
    <label>
      <input type="radio" name="type" {...this.bind("type", t)} /> {t}
    </label>
  ));
}
```

Each option renders with the shared `flow:model="type"`, its own `value`, and `checked` on whichever one matches the current state. A bare `value={…}`/`checked={…}` on a radio is emitted as a plain attribute and never inferred as a binding — one option in a group cannot own the group's state.

By default the value stays **local** — it updates the DOM instantly and is flushed to the server with your next action. Add `live` to sync to the server as you type, or `blur` to sync when the input loses focus:

```tsx
<input value={this.draft} />            {/* local; flushed with the next action */}
<input value={this.search} live />      {/* syncs to the server as you type      */}
<input value={this.title}  blur />      {/* syncs to the server on blur          */}
```

`live` inputs also update other client-side bindings reactively as you type. A `live` **text** input debounces its server sync by ~150ms, so fast typing doesn't fire a round-trip on every keystroke (real-time validation and reactive server state update when you pause, not per character). Discrete controls — checkbox, radio, `<select>`, range — sync immediately, since a pick isn't a stream of keystrokes. The DOM and any client-reactive bindings still update on every keystroke either way; only the server sync waits. (The value is never lost: your local state is current, and any action flushes the full snapshot.)

Two more modifiers clean the value at the edge, so the server never sees a numeric string or stray whitespace and you write no coercion in `onUpdated`:

```tsx
<input type="number" value={this.age} number />   {/* the bound value is a real number, not "42" */}
<input value={this.name} trim />                   {/* whitespace stripped before it syncs */}
```

Add `draft="key"` to keep an unsubmitted value across a reload or crash — it mirrors to `localStorage` and restores on mount (only when the field is empty, so server content always wins), then clears itself once the server empties the field after a successful submit. It's a client-side safety net; the server snapshot stays the authority:

```tsx
<textarea value={this.body} draft="post-body" />   {/* survives a refresh until you submit */}
```

And two focus helpers close the loop after a re-render, where focus is easily lost:

```tsx
<input value={this.email} autoFocus />      {/* focus on mount (won't steal focus you've placed) */}
<input value={this.email} focusOnError />   {/* after a failed submit, focus jumps to the first invalid field */}
```

`focusOnError` is the WCAG "send focus to the first error" behaviour, and it won't yank focus out of a field you're actively editing.

### Validation messages

Pass a field off `this.errors` to the `error` prop and Flow renders that field's first validation message reactively — it appears when the field is invalid and clears when it's fixed:

```tsx
<input value={this.email} />
<span error={this.errors.email} class="text-red-500" />
```

No `errors.has(...)` checks, no manual show/hide.

### Reactive classes and attributes

A `className`/`class` (or `style`, `href`, …) that depends on `@expose` or `@locked` state compiles to a reactive client binding, so it updates without a round-trip:

```tsx
<span className={this.count > 10 ? "text-emerald-400" : "text-white"}>
  {this.count}
</span>

<button className={this.active ? "btn-primary" : "btn-secondary"}>
  {this.active ? "Active" : "Inactive"}
</button>
```

### Control flow

Use normal TypeScript control flow in `render()` — `.map()`, ternaries, and `&&` are all supported:

```tsx
override async render() {
  return (
    <div>
      {this.todos.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul>
          {this.todos.map((t) => (
            <li key={String(t.id)}>{t.title}</li>
          ))}
        </ul>
      )}

      {this.isAdmin && (
        <button onClick={this.purge}>Purge all</button>
      )}
    </div>
  );
}
```

Always provide a `key` when mapping over items — the morph algorithm uses it to match DOM nodes and avoid re-creating elements unnecessarily.

### Loading, confirm, polling, and show/hide

Common interaction states are first-class props:

```tsx
{/* Disable the button while the action is in flight */}
<button onClick={this.save} loadingAttr="disabled">Save</button>

{/* Show a spinner while any action runs */}
<div showOnLoading class="spinner" />

{/* Show content when no action is in flight */}
<div hideOnLoading>Ready</div>

{/* Ask for confirmation before calling the action */}
<button onClick={this.delete} confirm="Delete this permanently?">Delete</button>

{/* SPA-style navigation — layout stays mounted */}
<a href="/dashboard" navigate>Dashboard</a>

{/* Prefetch the page on hover (after ~60ms) */}
<a href="/posts" navigate hover>Posts</a>

{/* Poll a server action on an interval */}
<div poll={{ every: "5s", action: this.tick }} />

{/* Reactive show/hide off a boolean @expose prop */}
<button onClick={() => (this.showModal = true)}>Open</button>
<div show={this.showModal} class="modal">…</div>
```

`show={this.showModal}` toggles visibility reactively off a boolean `@expose`/`@locked` property — flip it from a client expression (instant) or a server action, and the element shows/hides with no manual `style` juggling.

Add `transition` to animate the show/hide instead of an instant flip — a single prop covers **both** enter and leave (the leave half plain `show=` can't do, since the element would otherwise vanish before any animation runs):

```tsx
<div show={this.modal} transition class="modal">…</div>                {/* default: fade */}
<div show={this.menu}  transition="scale">…</div>                     {/* preset */}
<aside show={this.drawer} transition="slide-right">…</aside>          {/* directional */}
```

Presets: `fade` (default), `scale`, `slide-up`, `slide-down`, `slide-left`, `slide-right`. The animation runs entirely on the client (no round-trip), the first paint snaps to the final state without animating, and `prefers-reduced-motion` is honoured automatically.

### Accessible validation, wired for free

You don't wire ARIA by hand. When an input is bound with `value={this.email}` and its message rendered with `<span error={this.errors.email} />`, the runtime links them for you — the input gets `aria-describedby` pointing at the message region and `aria-invalid` while the field is invalid, so a screen-reader user hears exactly what a sighted user sees. The ids are stable across morphs, so the relationship never breaks on a re-render. Nothing to add to your markup beyond the `value=` / `error=` props you're already writing.

### Raw Alpine escape hatch

The underlying client state is exposed to Alpine as the `$flow` magic, so any raw Alpine attribute works when you need it:

```tsx
<span x-text="$flow.count > 10 ? 'High' : 'Low'" />
```

The `flow:*` directives (`flow:click`, `flow:model`, `flow:show`, …) that the compiler emits are also accepted in plain HTML for cases where you're generating markup outside the JSX compiler.

### Client magics live on $flow, not the class

A handful of client-only helpers — writing a prop and syncing it, toggling a boolean, calling a parent action, optimistic list mutations — don't belong to any one component and never run on the server. Rather than crowd the component class (and reserve common names like `set`, `on`, `watch`, `parent` that you might want for your own methods), they all live on a single global object, `$flow`. Framework helpers wear a `$`; the bare names stay yours.

```tsx
<button onClick={() => $flow.set("open", true)}>Open</button>     {/* write + sync an @expose prop */}
<button onClick={() => $flow.toggle("open")}>Toggle</button>
<button onClick={() => $flow.parent.save()}>Save</button>          {/* call a parent action */}
<button onClick={() => $flow.cancel()}>Cancel</button>            {/* stop a running @task */}
```

The full set: `$flow.set` / `$flow.get` / `$flow.toggle` / `$flow.call` / `$flow.commit` / `$flow.refresh`, `$flow.dispatch` / `$flow.dispatchTo` / `$flow.dispatchSelf` / `$flow.on`, `$flow.watch`, `$flow.parent`, `$flow.store`, `$flow.whisper` / `$flow.onWhisper`, `$flow.cancel`, and `$flow.appendOptimistic` / `$flow.removeOptimistic`. `$flow` is typed globally, so they all autocomplete with no import.

Because they sit on `$flow` and not on `this`, a name like `set` or `on` is free to be _your_ `@expose` method — if you define `set()`, then `this.set()` calls yours, while `$flow.set()` is still the framework helper. (`this.refresh()`, `this.dispatch()`, and the other real Component methods keep working directly on `this` in both server and client code.)

### The global client store

Most state in Flow belongs to one component — `@expose` and `@locked` put it in that component's snapshot, and the server stays authoritative. But some UI state is genuinely app-wide and the server has no stake in it: whether dark mode is on, whether the sidebar is open, whether a command palette is showing. Routing that through the server would mean a WebSocket round-trip every time a user flips a switch, for a value the server never needs to see.

`$flow.store` is for exactly that — a single client-only object, shared across every component on the page, that you read and write in JSX client expressions:

```tsx
import { Component } from "@zerotal/flow";

export class Header extends Component {
  override async render() {
    return (
      <header class={$flow.store.ui.dark ? "bg-black text-white" : "bg-white text-black"}>
        <button onClick={() => ($flow.store.ui.dark = !$flow.store.ui.dark)}>
          {$flow.store.ui.dark ? "Light" : "Dark"} mode
        </button>
        <aside show={$flow.store.ui.sidebar}>…</aside>
      </header>
    );
  }
}
```

Every one of those `$flow.store.*` reads updates **instantly, with no server round-trip** — the compiler turns them into native Alpine bindings backed by client-side reactivity. A write from a client handler (the `onClick` above) mutates the shared object, and every component reading that value re-renders at once. Because it lives entirely in the browser, it also keeps working while the WebSocket is down.

Declare the store's initial shape once, at app start, in `resources/js/app.ts`. Import `defineStore` from the browser-safe `@zerotal/flow/store` subpath (not the package barrel, which pulls server code into the browser bundle):

```ts
import { defineStore } from "@zerotal/flow/store";

defineStore({ ui: { dark: false, sidebar: true } });
```

And type it by augmenting the `FlowStore` interface (from the `/store` subpath, where it's declared), which makes every `$flow.store.*` access checked and autocompleted:

```ts
declare module "@zerotal/flow/store" {
  interface FlowStore {
    ui: { dark: boolean; sidebar: boolean };
  }
}
```

**Which to use.** Reach for `$flow.store` when the state is live UI shared _across_ components and the server doesn't need it. Reach for `@session` when a preference must survive a page refresh — it's persisted server-side, and the common pattern is both: the store drives the instant UI, and a single deferred action syncs the settled value to `@session`. Reach for `@expose` when one component owns the state and the server may reconcile it. The rule of thumb: if getting the value wrong could only ever be a cosmetic glitch — never a wrong answer or a security decision — it's a good fit for the store.

The store is client-only by design: use it inside JSX client expressions (handlers, attribute bindings, text children), where the compiler routes it to the client global. It can't switch between JSX subtrees (`{$flow.store.x ? <A/> : <B/>}`); drive the DOM from it with a class, `show`, or text binding instead.

A page that _reads_ `$flow.store` in a binding must be AOT-compilable — the compiler turns those reads into client bindings, but the runtime fallback (used when a page can't be statically compiled) would try to evaluate `$flow` on the server, where it doesn't exist. In practice this means a page with a reactive `$flow.store` read should avoid the patterns that force the runtime path: an imported child component in `render()` (`<Header/>`), a `class={someLocalConst}`, or a numeric-literal attribute (`rows={3}` → use `rows="3"`). Writing `$flow.store` in a handler (`onClick={() => …}`) is always fine.

### Full page example

```tsx
import { Component, expose, locked, validate, url } from "@zerotal/flow";
import type { Post } from "#app/models/Post.ts";

export class PostsPage extends Component {
  @url page: number = 1;
  @url search: string = "";
  @locked posts: Post[] = [];
  @locked total: number = 0;

  override async onMount() {
    await this.loadPosts();
  }

  @expose async loadPosts() {
    const q = Post.query()
      .when(this.search, (q) => q.whereLike("title", `%${this.search}%`))
      .orderBy("created_at", "desc");

    const page = await q.paginate(15);
    this.posts = page.data;
    this.total = page.total;
  }

  override async render() {
    return (
      <div>
        <input value={this.search} live placeholder="Search posts…" />
        <ul>
          {this.posts.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>
        <p>
          {this.total} total — page {this.page}
        </p>
      </div>
    );
  }
}
```

## The rest of the guide

Flow is a large surface. Each section below is its own page.

| Page                                              | What it covers                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Routing](/docs/flow/routing)                     | Map URLs to Flow pages — file-based routes, route parameters, and navigation.                         |
| [Decorators](/docs/flow/decorators)               | The decorators that expose state and actions to the client: @expose, @locked, @computed, and friends. |
| [Lifecycle Hooks](/docs/flow/lifecycle)           | Where to run code as a component mounts, updates, and tears down.                                     |
| [Events & Broadcasting](/docs/flow/events)        | Component events, browser events, and multiplayer state shared over WebSockets.                       |
| [Forms, Validation & Uploads](/docs/flow/forms)   | Two-way bound inputs, real-time validation, and server-handled file uploads.                          |
| [Pagination](/docs/flow/pagination)               | The Pagination mixin, URL-synced pages, and named paginators.                                         |
| [Built-in Components](/docs/flow/components)      | The component library that ships with Flow — forms, overlays, tables, and feedback.                   |
| [Layouts & Composition](/docs/flow/layouts)       | Wrap pages in layouts, compose behaviour with mixins, nest components, and pass markup between them.  |
| [Transport & Performance](/docs/flow/performance) | How updates reach the browser, what to do on hostile networks, and the polish that hides latency.     |
| [Testing](/docs/flow/testing)                     | Drive a component in-process, assert on its state, and test the rendered markup.                      |
| [Reference](/docs/flow/references)                | Every decorator, prop, directive, and client global in one table.                                     |

## Next steps

- [Routing](/docs/routing) — how `Router.flow()`, groups, and middleware fit into the wider router.
- [Validator](/docs/validator) — the full rule chain behind `@validate` and `this.validate()`.
- [Middleware](/docs/middleware) — write the guards you attach to Flow routes.
- [Session](/docs/session) — the store behind `@session` and `SessionMiddleware`.
- [Broadcasting](/docs/broadcasting) — drive `@on("echo:…")` real-time updates from the server.
- [Storage](/docs/storage) — configure the disks that file uploads write to.
- [Testing](/docs/testing/index) — patterns for the `FlowTest` harness and the rest of the suite.
