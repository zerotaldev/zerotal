# @zerotal/flow

> Reactive server-side rendering for Zerotal — server-rendered components, streamed over WebSocket, morphed into the DOM by Alpine.

**Maturity: experimental.** Flow ships on the same version line as the rest of Zerotal, but it is not at the same maturity as the stable packages. Its API may change between minor versions, and it has had far less production exposure than the core, ORM, and HTTP layers. The version number alone doesn't tell you that, which is why it is said here — build on it deliberately.

Flow is Zerotal's server-driven UI layer. Each page is a TypeScript `Component` class whose state lives on the server. You write plain JSX and bind handlers like `onClick={this.save}`; on each interaction the server hydrates the component from a signed snapshot, runs the method, re-renders, and streams only the changed HTML back, which Alpine.js morphs into the page. There is no API layer, no client-side store, and no hand-written client reactivity — the server is the single source of truth.

Flow began life as **Geleza** — isiZulu for _"to flow"_ — and the name turned out to describe the architecture better than anything we could invent. Settling on English package names, we translated it rather than replaced it.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/flow
```

> **Why `typescript` is a production dependency.** Flow ahead-of-time compiles
> your `Component` classes' JSX into string-concatenation render functions **at
> application boot** (`FlowProvider.onStarting()`), using the TypeScript
> compiler API to parse each page's source. Zerotal packages ship TypeScript
> source rather than build output, so this compile step runs on the server that
> boots the app — the compiler is genuinely needed at runtime, not only at dev
> time.

Register `FlowProvider` in `bootstrap/providers.ts`. It mounts the WebSocket handler at `/__flow`, builds the client runtime (Alpine + the Flow bridge), and injects it on every page response:

```typescript
import { FlowProvider } from "@zerotal/flow";

export default [
  // …your other providers
  FlowProvider,
];
```

Set the JSX pragma per file with `/** @jsxImportSource @zerotal/flow */`, or globally in `tsconfig.json` via `"jsxImportSource": "@zerotal/flow"`.

## How it works

1. A `GET` request renders the page on the server, serialises its state into a **signed snapshot** embedded in the HTML, and streams the result. The browser restores the page from the snapshot.
2. The browser upgrades to a WebSocket. User interactions (clicks, input changes, navigation) are sent as frames carrying the snapshot plus the action to invoke.
3. The server **verifies the signature**, hydrates the component from the snapshot, applies any client-written property values, and runs the invoked action method.
4. The component re-renders and the server **diffs** the new output against the old.
5. Only the changed DOM patches are streamed back and **morphed** into the page by `@alpinejs/morph`. A fresh snapshot ships with each patch.

Your component code therefore runs exclusively on the server: no bundler step for application logic, no client hydration mismatch, and the browser never receives your business logic.

A named method reference (`onClick={this.save}`) is always a **server action** — it round-trips and re-renders. An arrow function (`onClick={() => this.count++}`) is always a **client expression** — it updates the DOM instantly with no round-trip, and the new value is flushed to the server with your next action.

## Usage

```tsx
/** @jsxImportSource @zerotal/flow */
import { Component, expose, validate } from "@zerotal/flow";

export class CounterPage extends Component {
  @expose count: number = 0;
  @expose @validate("required|min:2") name: string = "";

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        {/* Two-way bind an input by passing state to `value` */}
        <input value={this.name} live placeholder="Your name" />
        <span error={this.errors.name} class="text-red-500" />

        <p>Count: {this.count}</p>

        {/* Server action — round-trips and re-renders */}
        <button onClick={this.increment} loadingAttr="disabled">
          +
        </button>

        {/* Client expression — updates the DOM instantly, no round-trip */}
        <button onClick={() => this.count--}>−</button>
      </div>
    );
  }
}
```

Register the route with the `flow` router helper:

```typescript
import { Router } from "@zerotal/core";
import { CounterPage } from "./CounterPage.tsx";

Router.flow("/counter", CounterPage);
```

Bindings the compiler understands directly: `value={this.x}` / `checked={this.x}` (two-way for `@expose`, read-only for `@locked`), `error={this.errors.field}` (reactive validation message), reactive `class`/`style`/`href`, plus first-class interaction props such as `live`, `blur`, `loadingAttr`, `show`, `confirm`, `navigate`, and `poll`. There is no `flow()` wrapper or `this.bind(...)` in component templates — the compiler reads each prop and emits the right directive for you. When you need raw Alpine, the client state is exposed as the `$flow` magic.

## Decorators

All imported from `@zerotal/flow`.

| Decorator                        | Purpose                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@expose`                        | Two-way contract with the browser — on a property it syncs both ways; on a method it makes it callable over the WebSocket. |
| `@locked`                        | Pushed to the client for display only; survives round-trips in the snapshot but the client cannot mutate it.               |
| `@validate("rule")`              | Attaches validation rules to a property, picked up by `this.validate()`.                                                   |
| `@url` / `@url({ as, history })` | Syncs a property to the URL query string (custom name and history push supported).                                         |
| `@session`                       | Persists a property in the HTTP session across page loads (not in the snapshot).                                           |
| `@computed`                      | A getter derived from other state; not stored, memoized per render, reactive on the client.                                |
| `@transient`                     | Excluded from the snapshot; reset to its default on every round-trip.                                                      |
| `@renderless`                    | An exposed method that runs but skips the re-render cycle (downloads, side-effects).                                       |
| `@on("event")`                   | Listens for cross-component events and real-time broadcasts (auto-exposed).                                                |
| `@reactive`                      | A child prop the parent re-pushes whenever it changes, re-rendering the child.                                             |
| `@modelable`                     | A two-way child prop — writes from the child flow back up to the parent.                                                   |

Action helpers available inside any exposed method include `this.flash()`, `this.redirect()`, `this.refresh()`, `this.title()`, `this.client()`, `this.download()`, `this.dispatch()`, `this.stream()`, and the `this.errors` proxy (`has`, `any`, `addError`, `resetValidation`). Lifecycle hooks: `setup`, `onBoot`, `onMount`, `onHydrate`, `onUpdating`/`onUpdated`, `onUpdate`, `onRendering`, `onRendered`, `onDehydrate`, `onError`.

## Built-in components

**UI components:** `Link`, `Head`, `Title`, `Persist`, `Modal`, `Drawer`, `Flash`, `Alert`, `Loading`, `Errors`, `ErrorMessage`, `Table`, `Pager`, `InfiniteScroll`, `Dropdown`, `Tabs`, `Tooltip`, `FileUpload`.

**Headless (unstyled, accessible) primitives:** `Switch`, `Checkbox`, `Select`, `RadioGroup`, `Listbox`, `Combobox`, `Disclosure`, `Accordion`, `Popover`, `Field`, `Label`, `Description`, `Fieldset`, `Legend`.

**Mixins & helpers:** compose features with `Component.using(Pagination, FileUploads)` — the `Pagination` mixin (`page` state + `nextPage`/`gotoPage`/…, paired with `Model.paginate()` and rendered by `<Pager>`) and the `FileUploads` mixin (`removeUpload`, paired with `<FileUpload>` + `TemporaryUploadedFile`). Also `Form` + `registerForm`, the `paginate` helper + `Paginator` type, and `Layout` for shared page shells.

**Slots:** a child component's plain children are its default slot; a `slots={{ header, footer }}` prop supplies named slots. The child places them with `this.slot(name)` / `this.slot()` and branches on `this.hasSlot(name)` — ideal for reusable shells (cards, modals, panels). Slot markup renders in the parent's scope and is carried, signed, in the child's snapshot.

**Layouts:** attach a shell with `static layout = AppLayout` (a `Layout` subclass), or the JSX-native `override layout(page)` hook — wrap the rendered page in any component and pass named regions as ordinary props (`<AppLayout title={…}>{page}</AppLayout>`), matching the framework's React/Inertia `Page.layout` convention. Give the shell root `data-flow-layout="…"` so `navigate` keeps it mounted across visits.

Bundled Alpine plugins are surfaced as props: `mask` (`@alpinejs/mask`), `trap` (`@alpinejs/focus`), `collapse` (`@alpinejs/collapse`), `anchor` (`@alpinejs/anchor`), and `$persist` (`@alpinejs/persist`).

## Subpath exports

| Subpath                          | Contents                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `@zerotal/flow`                  | Full public API — `Component`, `Layout`, `Form`, decorators, built-in components, helpers. |
| `@zerotal/flow/jsx-runtime`      | JSX runtime for production builds (`jsxImportSource`).                                     |
| `@zerotal/flow/jsx-dev-runtime`  | JSX runtime used in development.                                                           |
| `@zerotal/flow/compiler-helpers` | Runtime helpers the AOT compiler emits into compiled templates.                            |
| `@zerotal/flow/testing`          | `FlowTest` — drive the full server pipeline in-process, no WebSocket needed.               |

## Documentation

- [Overview](../../docs/flow/index.md)
- [Decorators](../../docs/flow/decorators.md)
- [Lifecycle Hooks](../../docs/flow/lifecycle.md)
- [Components](../../docs/flow/components.md)
- [Forms](../../docs/flow/forms.md)
- [Layouts & Composition](../../docs/flow/layouts.md)
