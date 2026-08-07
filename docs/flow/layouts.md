---
title: Flow Layouts & Composition
description: Wrap pages in layouts, nest components, and pass markup between them.
---

# Layouts & Composition

Wrap pages in layouts, nest components as islands, stream slow content progressively, attach middleware, and test it all.

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

### Lazy and deferred loading

```tsx
// Defer mount until the placeholder enters the viewport (intersection observer)
<HeavyChart key="chart" lazy />

// Mount immediately after page paint (non-blocking)
<Sidebar defer />
```

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
