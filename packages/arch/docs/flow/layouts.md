---
title: Flow Layouts & Composition
description: Wrap pages in layouts, compose behaviour with mixins, nest components, and pass markup between them.
---

# Layouts & Composition

Wrap pages in layouts, compose reusable behaviour with mixins, nest components as islands, stream slow content progressively, attach middleware, and test it all.

## Layouts

A `Layout` wraps the page content with persistent shell UI — the nav bar, sidebar, footer. The layout is never re-rendered on WebSocket updates; only the page content swaps. `navigate` links update the page content without a full reload while keeping the layout mounted.

```tsx
import { Layout } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Link, Flash } from "@zerotal/flow";

export class AppLayout extends Layout {
  // Injected into <head> on every initial render
  static override head = `
    <link rel="stylesheet" href="/app.css">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  `;

  override render(slot: HtmlNode) {
    return (
      <div class="min-h-screen bg-gray-50">
        <nav class="flex items-center px-6 py-4 border-b bg-white">
          <Link href="/dashboard" navigate class="font-semibold text-lg">
            My App
          </Link>
          <div class="ml-auto flex gap-4">
            <Link href="/posts" navigate class="data-[current]:font-bold">
              Posts
            </Link>
            <Link href="/settings" navigate class="data-[current]:font-bold">
              Settings
            </Link>
          </div>
        </nav>
        <main class="p-8">{slot}</main>
        <Flash position="bottom-right" />
      </div>
    );
  }
}
```

Attach the layout to a page:

```tsx
export class DashboardPage extends Component {
  static layout = AppLayout;

  override async render() {
    return (
      <div>
        <h1>Dashboard</h1>
      </div>
    );
  }
}
```

The layout's `render(slot)` receives the page's HTML as `slot`. Multiple pages can share a layout; each keeps its own state and snapshot.

### The `layout(page)` hook — layouts as plain JSX

`static layout = SomeLayout` is the class form. The JSX-native alternative — and the same convention the framework's React/Inertia pages use — is to override the `layout(page)` method and wrap the rendered page in **any JSX** you like. There is no separate `Layout` base class and no named-slot mechanism: a layout is just a component you wrap the page in, and its regions are ordinary **props**.

```tsx
import { Component } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AppLayout } from "#app/layouts/AppLayout.tsx";

export class DashboardPage extends Component {
  static title = "Dashboard";

  // `page` is the rendered <div data-flow-root>…</div>. Wrap it however you like;
  // named regions like `title` / `actions` are just props on your layout component.
  override layout(page: HtmlNode) {
    return (
      <AppLayout
        title={DashboardPage.title}
        actions={<button onClick={this.refresh}>Refresh</button>}
      >
        {page}
      </AppLayout>
    );
  }

  override async render() {
    return (
      <div>
        <h1>Dashboard</h1>
      </div>
    );
  }
}
```

`AppLayout` is an ordinary function component — nothing framework-specific:

```tsx
export function AppLayout(props: { title?: string; actions?: HtmlNode; children?: unknown }) {
  return (
    <div data-flow-layout="app" class="min-h-screen bg-gray-50">
      <header class="flex items-center px-6 py-4 border-b">
        <span class="font-semibold">{props.title}</span>
        <div class="ml-auto">{props.actions}</div>
      </header>
      <main class="p-8">{props.children}</main>
    </div>
  );
}
```

Two things to know:

- **Give the shell root a stable `data-flow-layout="app"`.** That marker is what lets `navigate` swap only the page root and keep the shell mounted across visits. If you omit it, Flow derives one from the wrapper source — which matches for a plain `(page) => <AppLayout>{page}</AppLayout>`, but not when the wrapper passes page-specific props — so declaring it on the layout component is the reliable choice.
- **The shell lives outside the reactive root.** Like `static layout`, the shell renders once and is never re-rendered or re-sent on WebSocket actions. So layout regions are for **display** (titles, breadcrumbs, status); an `onClick={this.save}` placed in the shell has no owning component root above it — keep interactive controls in the page body.

`static layout` and the `layout(page)` hook are interchangeable; when a page has both, the `layout(page)` method wins. Global stylesheets/fonts for a JSX-native layout go through a `<Head>` inside the layout component (or the page's `static head`), rather than `static head` on a `Layout` class.

### Layout head

`static head` injects content into the `<head>` element on the initial render. For per-page head content (title, meta), use `<Head>` inside the page's `render()` — it's hoisted into `<head>` on load and on every `navigate` visit:

```tsx
import { Head } from "@zerotal/flow";

override async render() {
  return (
    <div>
      <Head>
        <title>{this.post.title} — My App</title>
        <meta name="description" content={this.post.excerpt} />
      </Head>
      <h1>{this.post.title}</h1>
    </div>
  );
}
```

## Sections

A layout owns regions a page cannot reach. When a page needs to put something _there_ — a toolbar
button, a breadcrumb trail, a heading — the alternatives are threading it through every component in
between as props, or the layout knowing about every page that might contribute. Sections invert
that: the component that owns the content declares it, and the layout declares a hole.

```tsx
// In the layout — declare the hole
import { SectionOutlet } from "@zerotal/flow";

<header class="flex items-center gap-2">
  <h1>Admin</h1>
  <SectionOutlet name="toolbar" />
</header>;
```

```tsx
// In any page — fill it
import { SectionContent } from "@zerotal/flow";

<SectionContent name="toolbar">
  <button onClick={this.publish}>Publish</button>
</SectionContent>;
```

`<SectionContent>` renders nothing where it appears. Children of `<SectionOutlet>` are the default,
used when no page published anything:

```tsx
<SectionOutlet name="toolbar">
  <span class="text-sm text-gray-500">No actions</span>
</SectionOutlet>
```

Two components may publish to the same name; their content accumulates in render order rather than
one replacing the other.

**Order does not matter.** An outlet reserves its place and is filled after the page _and_ the
layout have rendered — which is what makes the usual arrangement work at all, since the layout wraps
a page that has already rendered.

> **Sections resolve once per document render.** A WebSocket patch re-renders a component, not the
> layout, so content published during one does not reach an outlet outside the component being
> patched. Put values that change on interaction in the component that renders them, and use
> sections for content that is settled by the time the page paints.

## Composing behaviour with mixins

A layout wraps a page's _markup_. A mixin composes a page's _behaviour_ — page state, actions,
lifecycle — so a feature lives in one reusable place instead of being copied into every page that
needs it. Compose them with the `Component.using(...)` static:

```tsx
import { Component, Pagination, FileUploads } from "@zerotal/flow";

export class PostsPage extends Component.using(Pagination, FileUploads) {
  override async render() {
    return <div data-flow-root>Page {this.page}</div>;
  }
}
```

Mixins fold left to right, and everything flows through to the final page: `Component`'s own
surface (`flash()`, `redirect()`, `validate()`, the client magics), plus every mixin's `@expose` /
`@locked` members. Mixin props register on the mixin's prototype, which sits in the page's
prototype chain, so the snapshot, reactivity, client writes and `@url` sync all treat them exactly
like props declared on the page itself.

Flow ships two mixins — [`Pagination`](/docs/flow/pagination) and
[`FileUploads`](/docs/flow/forms) — and you write your own the same way.

### Writing a mixin

A mixin is a function taking a base class and returning a class that extends it. Bind the base to
`Constructor<Component>` to require a Component lineage, and return an `abstract class` so the
mixin does not have to implement `render()` — the final page supplies that:

```tsx
// app/flow/mixins/sorting.ts
import { Component, expose, url, type Constructor } from "@zerotal/flow";

export function Sorting<T extends Constructor<Component>>(Base: T) {
  abstract class WithSorting extends Base {
    @url sortBy = "id";
    @url sortDir: "asc" | "desc" = "asc";

    @expose toggleSort(column: string): void {
      if (this.sortBy === column) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortBy = column;
        this.sortDir = "asc";
      }
    }
  }
  return WithSorting;
}
```

```tsx
export class UsersPage extends Component.using(Sorting, Pagination) {}
```

### Composing onto a shared base

`using` composes onto whatever class you call it on, not onto `Component` specifically. That lets
an app-level base carry its own state and actions and still take mixins, without being flattened
out of the prototype chain:

```tsx
abstract class AdminPage extends Component {
  @expose breadcrumb = "admin";

  @expose async guard() {
    /* shared authorization for every admin page */
  }
}

export class DashboardPage extends AdminPage.using(Pagination) {
  override async render() {
    return (
      <div data-flow-root>
        {this.breadcrumb} — page {this.page}
      </div>
    );
  }
}
```

`DashboardPage` is still an `AdminPage`, so the base's `@expose` members and the mixin's are both
live on it.

### Chaining

The composed class carries `using` itself, so composition can be built up in stages — useful when
a shared base is defined in one file and extended in another:

```tsx
const AdminBase = Component.using(Pagination).using(Sorting);
export class ReportsPage extends AdminBase.using(FileUploads) {}
```

> **Note** — a page composed with `using(...)` renders through the runtime path rather than the
> ahead-of-time compiler, which only statically sees a page's own `extends Component` plus its
> locally declared members. This is the same fallback complex pages already use; behaviour is
> identical, you just do not get the compile step for that page.

## Nested components

Embed other `Component` subclasses as child components. Each child has its own isolated state, its own snapshot, and its own WebSocket update cycle. A parent re-render does not re-render existing children — their DOM and state are preserved (island architecture).

```tsx
import { StatsWidget } from "./StatsWidget.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";

export class DashboardPage extends Component {
  static layout = AppLayout;

  override async render() {
    return (
      <div class="grid grid-cols-3 gap-6">
        <h1 class="col-span-3">Dashboard</h1>

        {/* Embed child components */}
        <StatsWidget />
        <ActivityFeed />

        {/* Multiple instances of the same class — use key to distinguish */}
        <CounterWidget key="counter-a" step={1} label="Likes" />
        <CounterWidget key="counter-b" step={5} label="Views" />
      </div>
    );
  }
}
```

### Passing props

Each prop the parent passes is assigned onto the same-named field before any lifecycle hook runs — the field's initialiser is the default:

```tsx
export class CounterWidget extends Component {
  @locked step: number = 1;
  @locked label: string = "Count";

  @expose count: number = 0;

  @expose increment(): void {
    this.count += this.step;
  }

  override async render() {
    return (
      <div class="card">
        <p class="text-sm text-gray-500">{this.label}</p>
        <p class="text-3xl font-bold">{this.count}</p>
        <button onClick={this.increment}>+{this.step}</button>
      </div>
    );
  }
}
```

Props that need to survive WebSocket round-trips must be `@locked` so they are included in the snapshot. A `@locked` prop is set once at mount and stays fixed for the child's lifetime.

### Slots

Where props pass **data** into a child, slots pass **markup**. A child component's plain children become its **default slot**; a `slots={{ … }}` prop supplies **named slots**. Inside the child, place each with `this.slot(name)` (or `this.slot()` for the default), and branch on `this.hasSlot(name)` to drop an optional wrapper entirely. This is the pattern for reusable shells — cards, modals, panels, page headers — where the container is fixed but the contents vary per use.

```tsx
// The reusable shell — header and footer are optional.
export class Card extends Component {
  override async render() {
    return (
      <div class="rounded-xl border bg-white shadow-sm">
        {this.hasSlot("header") && (
          <header class="border-b px-5 py-3 font-semibold">{this.slot("header")}</header>
        )}
        <div class="px-5 py-4">{this.slot()}</div>
        {this.hasSlot("footer") && (
          <footer class="border-t px-5 py-3 text-right">{this.slot("footer")}</footer>
        )}
      </div>
    );
  }
}

// A page using it — default children fill the body; named slots fill header/footer.
export class BillingPage extends Component {
  override async render() {
    return (
      <Card
        slots={{
          header: <h2>Payment method</h2>,
          footer: <button onClick={this.save}>Save</button>,
        }}
      >
        <p>Your card ending in 4242 is active.</p>
      </Card>
    );
  }
}
```

Slot content is rendered in the **parent's** scope and carried in the child's snapshot (signed, so it can't be forged from the client). Because it lives in the snapshot, it survives the child's own round-trips — a child action re-renders with the same header/body/footer without the parent running again.

Two consequences worth knowing:

- **Slots are set at mount, not reactive.** They reflect the parent's state at the moment the child mounts. If the parent later re-renders, the existing child island is preserved (its DOM and snapshot are kept), so the slot HTML does not change underneath it. For a value that must track the parent live, pass it as a `@reactive` prop instead of as slot markup.
- **Prefer plain markup in slots.** Interactive `onClick={this.method}` handlers inside a slot bind to the _parent's_ actions (the slot was rendered in the parent's scope), which is usually what you want for a footer button. Nesting another _stateful child component_ inside a slot is not supported — embed it in the child's own `render()` instead.

### `key` in a list

Give every child rendered inside a `.map()` a `key` tied to the row's own identity:

```tsx
{
  this.settings.map((s) => <SettingRow key={`setting-${s.id}`} settingKey={s.key} />);
}
```

This is a correctness requirement, not an optimisation, and it is worth understanding why.

A child's `data-flow-id` is how the client morph pairs the incoming markup with the island already on the page — and a parent re-render deliberately emits an already-mounted child as an **empty stub**, on the understanding that the pairing will preserve the child's live DOM. When two renders disagree about which child owns an id, that stub is what lands in the page.

Without a `key`, the id is derived from the child's seed props (`@reactive` and `@modelable` props are excluded, because those exist to change without remounting). That is stable enough for the common case: remove an item from the middle of a list and the rows around it keep their islands. But two siblings whose props are identical are, as far as the framework can see, the same child — they share an id, and therefore share DOM and state. Flow logs a warning the first time it sees that, in development only.

None of this is visible from the server. SSR, snapshot assertions and `FlowTest.mount(...).call(...)` all render the full child every time, because they never take the already-mounted branch — only a real browser applying a real WebSocket patch does. So the guard is the `key`, not the test suite.

Keys are sanitised to `[a-zA-Z0-9_-]`, so dots are stripped and `a.b` collides with `ab`.

### Lazy, deferred, and streamed loading

```tsx
// Defer mount until the placeholder enters the viewport (intersection observer)
<HeavyChart key="chart" lazy />

// Mount immediately after page paint (non-blocking)
<Sidebar defer />

// Render on the SAME response — placeholder first, real markup streamed after
<SalesReport stream />
```

`lazy` and `defer` both mount over the socket on a **second round trip**, which is what you want for
content that may never be needed: a widget below the fold, a tab nobody opens.

`stream` is for content that is definitely needed and merely slow. The shell reaches the browser
without waiting for it, and the child's markup arrives as a trailing chunk of the same response —
no second request, no socket, and no client runtime needed (the swap happens during parse, so it
works before and without Alpine). See [Streaming the initial render](#streaming-the-initial-render).

Override `placeholder()` to customise the skeleton shown while a lazy component loads:

```tsx
export class HeavyChart extends Component {
  override placeholder() {
    return <div class="h-64 w-full rounded-xl bg-gray-200 animate-pulse" />;
  }

  override async onMount() {
    this.data = await Analytics.fetchChartData();
  }

  // …
}
```

## Reactive props

A `@locked` prop is frozen after mount. Mark a prop `@reactive` instead and the parent re-pushes its value whenever it changes, re-rendering the child — while the child keeps the rest of its own state intact:

```tsx
export class PriceTag extends Component {
  @reactive currency = "USD";
  @reactive amount = 0;

  @computed get formatted(): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.currency,
    }).format(this.amount);
  }

  override async render() {
    return <span class="price">{this.formatted}</span>;
  }
}

// Parent — when this.currency changes, PriceTag automatically re-renders:
<PriceTag currency={this.currency} amount={this.subtotal} />;
```

## Two-way props

`@modelable` is a reactive prop that also syncs **back** to the parent. The parent property and the child prop stay in lock-step, so you can build reusable input/control components:

```tsx
export class StarRating extends Component {
  @modelable rating: number = 0; // two-way bound to parent

  @expose set(n: number): void {
    this.rating = n; // updating it flows up to the parent
  }

  override async render() {
    return (
      <div class="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={String(n)}
            onClick={() => this.set(n)}
            class={n <= this.rating ? "text-yellow-400" : "text-gray-300"}
          >
            ★
          </button>
        ))}
      </div>
    );
  }
}

// Parent — this.productRating and StarRating.rating stay in sync both ways:
<StarRating value={this.productRating} />;
```

## Streaming

Flow streams in two distinct places: **during the initial page response**, so a slow child does not
hold up the shell, and **during an action**, so a long-running method can push progress before it
finishes. They solve different problems and do not interact.

### Streaming the initial render

Mark a child `stream` and the page paints immediately with that child's placeholder; its real markup
is appended to the same response as soon as it finishes rendering:

```tsx
override async render() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Totals />               {/* fast — rendered inline */}
      <SalesReport stream />   {/* slow — placeholder now, markup later */}
    </div>
  );
}
```

The browser receives the document up to the placeholder, then a `<template>` carrying the finished
markup and a one-line script that swaps it in. That script runs during parse, so the content appears
without waiting for the runtime — and without a second request. Override `placeholder()` on the
child to control what shows in the meantime.

A child that fails while streaming is replaced with a notice rather than failing the response: the
shell is already on the wire by then, so there is nothing left to fail. Everything else on the page
is unaffected.

Streaming applies to the initial `GET` only. Over the socket there is no open response to append to,
so `stream` degrades to an ordinary inline child render.

> **Streaming needs an unbuffered response.** Flow sets `X-Accel-Buffering: no` for nginx. Behind a
> proxy that buffers anyway, the browser simply receives the whole document at once — the page is
> correct, just not progressive.

### Streaming during an action

Push content to the client mid-action — before the final patch — using `this.stream()`. Useful for LLM token streaming, long-running progress updates, or any content that takes time:

```tsx
{/* In the template: declare the stream target */}
<div stream="answer" class="prose" />
<div stream="status" class="text-sm text-gray-500" />
```

```typescript
@expose async generate(): Promise<void> {
  this.stream("status", "Generating…");

  for await (const token of llm.stream(this.prompt)) {
    this.stream("answer", token); // appended progressively
  }

  this.stream("status", "Done.");
}

// Replace instead of append:
this.stream("output", freshContent, { replace: true });
```

`this.stream()` is a no-op during the initial SSR render — it only works inside WebSocket action handlers.

### `@task` — streaming, cancellable actions

`this.stream()` is the low-level primitive: it pushes raw HTML into a `flow:stream` target, but that content isn't part of the snapshot, so you must _also_ write the accumulated result to a field for the final render, and there's no built-in cancellation. `@task` handles both. Mark an async method `@task` and just **write the field** — the framework streams it:

```tsx
import { Component, task, expose } from "@zerotal/flow";

export class Chat extends Component {
  @expose answer = "";

  @task async generate() {
    this.answer = "";
    for await (const token of llm.stream(this.prompt, { signal: this.signal })) {
      if (this.cancelled) break; // cooperative cancellation
      this.answer += token; // ← streams to the browser as it's written
    }
  }
}
```

```tsx
{/* Bind the streamed field REACTIVELY (text={…} → flow:text, or x-text) so each write updates
    this element live off the client store — no flow:stream element, no re-render per chunk. */}
<button onClick={this.generate} loadingAttr="disabled">Generate</button>
<button onClick={() => $flow.cancel()} showOnLoading>Cancel</button>
<div text={this.answer} />
```

What `@task` gives you over a plain `@expose async` action:

- **Incremental streaming without a re-render.** While the task runs, the framework flushes throttled **field-level** snapshot diffs — the changed fields only, no HTML — so a reactive binding of the field (`text={this.answer}`, `x-text="$flow.answer"`, a reactive `:class`/`:attr`) updates the DOM straight off the client store as `this.answer += token` runs, with no per-chunk component re-render. The field _is_ the snapshot, so the final patch re-renders once to reconcile any **static** template positions (a plain `{this.answer}` text child updates then), and everything stays consistent — no double-writing. Bind the streamed field reactively for a live token-by-token view.
- **A loading state that spans the whole run.** The triggering control stays in its loading state (`loadingAttr`, `showOnLoading`, `<Loading>`) for the task's entire duration — partial patches don't clear it; only completion does.
- **First-class cancellation.** `this.signal` is a standard `AbortSignal` (pass it to `fetch`/an SDK); `this.cancelled` is a convenience boolean. On the client, `$flow.cancel()` stops the task — it's sent out-of-band (bypassing the per-component send queue, which the running task still occupies), and the server trips the task's `AbortSignal`. Cancellation is cooperative: check `this.cancelled`/`this.signal.aborted`, or let an aborted `signal` reject the async work you're awaiting.

This is the primitive for AI answers, build/deploy logs, and progress feeds — the streaming shape that usually needs a second endpoint and a client state library, here in one server method. Outside a running task, `this.signal` is an inert signal that never aborts, so `@task` code reads the same whether or not a cancellation is in flight.

## Middleware

Middleware attached to a `Router.flow()` call runs on the initial HTTP `GET` **and** on every WebSocket update for that page. This keeps auth gates active across the entire session, not just at page load:

```typescript
import { Router } from "zerotal";
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { RequireAdminMiddleware } from "#app/middleware/RequireAdmin.ts";
import { AdminDashboard } from "#app/flow/AdminDashboard.tsx";
import { PublicPosts } from "#app/flow/PublicPosts.tsx";

// No middleware — anyone can view
Router.flow("/posts", PublicPosts);

// Requires auth on every request (initial GET + WS)
Router.flow("/dashboard", DashboardPage, [RequireAuthMiddleware]);

// Requires auth AND admin role
Router.flow("/admin", AdminDashboard, [RequireAuthMiddleware, RequireAdminMiddleware]);
```

## Testing composed components

See [Testing](/docs/flow/testing) for the full guide — mounting, calling actions, seeding state, all assertions, database integration, and event testing.

`FlowTest` runs the full server-side pipeline in-process — no WebSocket connection needed. It's available from `@zerotal/flow/testing`.

### Mounting a composed component

```typescript
import { FlowTest } from "@zerotal/flow/testing";
import { CounterPage } from "../app/flow/CounterPage.tsx";

// Mount drives: onBoot → onMount → render → onDehydrate
const t = await FlowTest.mount(CounterPage);

// Inspect initial state
expect(t.page().count).toBe(0);
t.assertSee("Count: 0");
t.assertDontSee("Count: 1");
```

Mount with initial props (seed state before `onMount`):

```typescript
const t = await FlowTest.mount(PostsPage, { page: 2, search: "TypeScript" });
expect(t.page().search).toBe("TypeScript");
```

### Calling composed actions

```typescript
// call() drives: onBoot → onHydrate → action() → onUpdate → render → onDehydrate
await t.call("increment");
expect(t.page().count).toBe(1);
t.assertSee("Count: 1");

// Call with arguments
await t.call("setCount", 42);
expect(t.page().count).toBe(42);
```

### Updating composed state

Two ways to change a property between calls:

```typescript
// set() — direct assignment, no hooks fire
await t.set("draft", "Hello world");

// update() — simulates a client input, fires onUpdating/onUpdated hooks
await t.update("username", "alice");
```

Use `set()` to seed state for a specific scenario. Use `update()` to test that your `onUpdating`/`onUpdated` hooks work correctly.

### Assertions

**HTML assertions:**

```typescript
t.assertSee("Published post"); // HTML contains this string
t.assertDontSee("Error"); // HTML does NOT contain this string
```

**Validation assertions:**

```typescript
await t.call("save");
t.assertHasErrors("email"); // field has at least one error
t.assertHasErrors("email", "required"); // error message contains "required"
t.assertNoErrors(); // no errors at all
```

**Redirect assertions:**

```typescript
t.assertRedirectedTo("/dashboard");
t.assertNotRedirected();
```

**Flash assertions:**

```typescript
t.assertFlashed("success", "Saved."); // level + message substring
t.assertFlashed("error"); // just check the level
t.assertFlashed(undefined, "Something went"); // just check the message substring
```

**Event assertions:**

```typescript
t.assertDispatched("post-created");
```

### Composed accessors

```typescript
t.page(); // the Component instance — inspect properties directly
t.html(); // the rendered HTML string
t.errors(); // current validation error bag: Record<string, string[]>
t.effects(); // effects from the last action (flashes, redirects, events, downloads)
t.snapshot(); // the serialised snapshot
```

### Full test example

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { FlowTest } from "@zerotal/flow/testing";
import { LoginPage } from "#app/flow/LoginPage.tsx";
import { User } from "#app/models/User.ts";
import { withDatabase } from "#tests/helpers.ts";

describe("LoginPage", () => {
  test("redirects to dashboard on valid credentials", async () => {
    await User.create({ email: "alice@example.com", password: "secret123" });

    const t = await FlowTest.mount(LoginPage);
    await t.set("email", "alice@example.com");
    await t.set("password", "secret123");
    await t.call("login");

    t.assertRedirectedTo("/dashboard");
    t.assertNoErrors();
  });

  test("shows error on invalid credentials", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.set("email", "alice@example.com");
    await t.set("password", "wrongpassword");
    await t.call("login");

    t.assertNotRedirected();
    t.assertHasErrors("email", "credentials");
  });

  test("validates required fields", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.call("login"); // no email or password set

    t.assertHasErrors("email", "required");
    t.assertHasErrors("password", "required");
    t.assertNotRedirected();
  });

  test("normalises email to lowercase via onUpdated hook", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.update("email", "ALICE@EXAMPLE.COM");

    expect(t.page().email).toBe("alice@example.com");
  });
});
```

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
