---
title: Testing Flow Components
description: Drive a component in-process with FlowTest, and pin the wiring in a real browser with FlowBrowser.
---

# Testing

`FlowTest` runs the full Flow server-side pipeline in-process — no running server, no WebSocket connection, no browser. It's the fastest way to write component tests and covers the complete request cycle: mount, hydrate, action, render, dehydrate.

Import it from `@zerotal/flow/testing`.

## Mounting a component

`FlowTest.mount()` drives the **initial GET** cycle: `onBoot → onMount → onRendering → render → onRendered → onDehydrate`. It returns a test handle you can use for assertions and further interactions:

```typescript
import { FlowTest } from "@zerotal/flow/testing";
import { CounterPage } from "#app/flow/CounterPage.tsx";

const t = await FlowTest.mount(CounterPage);

// Inspect initial state
expect(t.page().count).toBe(0);
t.assertSee("Count: 0");
t.assertDontSee("Count: 1");
```

### Seeding initial state

Pass initial props to seed state before `onMount()` runs. Props are applied to the component instance before the lifecycle starts:

```typescript
const t = await FlowTest.mount(PostsPage, { page: 2, search: "TypeScript" });

expect(t.page().search).toBe("TypeScript");
expect(t.page().page).toBe(2);
t.assertSee("TypeScript");
```

This is equivalent to the component being navigated to with `?page=2&search=TypeScript` in the URL.

## Calling actions

`t.call(method, ...args)` drives a **WebSocket action frame**: `onBoot → onHydrate → [onUpdating/onUpdated] → action → onUpdate → onRendering → render → onRendered → onDehydrate`.

```typescript
await t.call("increment");
expect(t.page().count).toBe(1);
t.assertSee("Count: 1");

// Call with arguments
await t.call("setCount", 42);
expect(t.page().count).toBe(42);

// Call an async action that hits the database
await t.call("save");
t.assertRedirectedTo("/posts");
```

The full lifecycle fires on every `call()` — hooks like `onHydrate`, `onUpdate`, `onRendering`, and `onDehydrate` run exactly as they would in production.

### When an action throws

A `ValidationError` is an expected outcome: the error bag is populated, the page re-renders, and you assert on it with `assertHasErrors`.

Any other error is passed to `onError()` — as in production — and then **rethrown**, so the test fails with the real stack. This matters because the alternative is invisible: an action that throws produces no server error, no browser error, and an unchanged page, so a swallowed exception looks exactly like an action that ran and did nothing.

When the error path is what you're testing, opt in with `tolerateErrors()`:

```typescript
const t = (await FlowTest.mount(CheckoutPage)).tolerateErrors();
await t.call("submit");

t.assertErrored(/payment gateway/); // or t.lastError()
t.assertFlashed("error", "Payment failed");
```

## Updating state

Three methods change a property between calls:

```typescript
// set() — direct assignment, then re-renders; no hooks fire
await t.set("draft", "Hello world");
await t.set("page", 3);

// update() — simulates a client input; fires onUpdating and onUpdated hooks
await t.update("username", "alice");
await t.update("email", "alice@example.com");

// seed() — assignment WITHOUT re-rendering, for batching
await t.seed("step", 3);
await t.seed("mode", "advanced");
await t.render(); // one render for both
```

`set()` re-renders, so `html()` and every assertion that reads it describe the state you just set. Reach for `seed()` only when you're assigning several properties and want to pay for a single render — and remember that nothing reads the new values until the next `render()`, `update()`, or `call()`.

Use `set()` to put the component in a specific state for a test scenario. Use `update()` when you're testing that `onUpdating`/`onUpdated` hooks run correctly:

```typescript
// Test that onUpdatedUsername normalises to lowercase
const t = await FlowTest.mount(ProfilePage);
await t.update("username", "ALICE");

expect(t.page().username).toBe("alice"); // hook lowercased it
```

## HTML assertions

```typescript
t.assertSee("Published post"); // rendered HTML contains this string
t.assertDontSee("Error"); // rendered HTML does NOT contain this string
t.assertSee("<h1>Dashboard</h1>"); // can match HTML tags too
```

Both methods check `t.html()` — the raw rendered HTML string for this component. The check is a simple substring match, not a DOM query.

## Validation assertions

```typescript
await t.call("register"); // trigger a validation action

t.assertHasErrors("email"); // field has at least one error
t.assertHasErrors("email", "required"); // error message contains "required"
t.assertHasErrors("password", "min"); // error message contains "min"
t.assertNoErrors(); // no validation errors at all
```

`assertHasErrors(field, msg?)` checks the error bag returned from the last action. `msg` is a substring match on the first error message for that field.

## Redirect assertions

```typescript
await t.call("login");

t.assertRedirectedTo("/dashboard"); // last action redirected to this URL
t.assertNotRedirected(); // last action did NOT redirect
```

## Flash assertions

```typescript
await t.call("save");

t.assertFlashed("success", "Saved."); // level + message substring
t.assertFlashed("error"); // just check the level
t.assertFlashed(undefined, "Something went"); // just check the message substring
t.assertFlashed(); // any flash was emitted
```

## Event assertions

```typescript
await t.call("createPost");

t.assertDispatched("post-created"); // event was dispatched
t.assertDispatched("post-created", { id: 1 }); // event was dispatched with this payload
```

## Accessors

```typescript
t.page(); // the Component instance — inspect properties and call methods directly
t.html(); // the rendered HTML string from the last render
t.errors(); // current error bag: Record<string, string[]>
t.effects(); // effects from the last action: { flashes, redirects, events, downloads }
t.snapshot(); // the serialised snapshot blob
```

`t.page()` gives you the live component instance, so you can read any property:

```typescript
const page = t.page();
expect(page.posts.length).toBe(10);
expect(page.user?.email).toBe("alice@example.com");
expect(page.totalRevenue).toBe(450.0);
```

## No request scope

`FlowTest` drives the server-side pipeline but does **not** open a request context. There is no
`RequestContext.run` inside it, so anything reaching for the request throws rather than
returning empty:

- `Auth.user()` → `E_UNAUTHORIZED`
- `Auth.attempt()` / `Auth.login()` → `E_CONTEXT_OUTSIDE_REQUEST`
- request-scoped pagination, and any facade that reads `RequestContext`

That covers most actions on any page behind a sign-in, so open the scope yourself. `HttpContext.fake()`
rather than an object literal cast to the type — it carries a real `Request`, which matters as soon
as anything downstream reads a header (an audited model records the actor's IP, for one):

```typescript
import { RequestContext, HttpContext } from "@zerotal/core";

function asUser<T>(user: User | null, fn: () => Promise<T>): Promise<T> {
  const ctx = HttpContext.fake("http://localhost/");
  if (user) ctx.user = user;
  return RequestContext.run(ctx, fn);
}

await asUser(alice, async () => {
  const t = await FlowTest.mount(IssuePage, { issue });
  await t.call("postComment");
});
```

`app.actingAs()` does not help here: it encodes a session cookie for `app.get()`, and `FlowTest`
never makes a request to send it on.

## Testing with a database

`FlowTest` does not set up or tear down a database — use your test suite's standard database helpers. With Bun, wrap tests in a transaction that rolls back after each test for full isolation:

```typescript
// tests/flow/PostsPage.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FlowTest } from "@zerotal/flow/testing";
import { PostsPage } from "#app/flow/PostsPage.tsx";
import { DB } from "@zerotal/orm";
import { Post, User } from "#app/models/index.ts";

describe("PostsPage", () => {
  let tx: Awaited<ReturnType<typeof DB.beginTransaction>>;

  beforeEach(async () => {
    tx = await DB.beginTransaction();
  });

  afterEach(async () => {
    await tx.rollback();
  });

  test("shows published posts", async () => {
    const user = await User.create({ name: "Alice", email: "alice@example.com" });
    await Post.create({ title: "Hello world", status: "published", userId: user.id });
    await Post.create({ title: "Draft post", status: "draft", userId: user.id });

    const t = await FlowTest.mount(PostsPage);

    t.assertSee("Hello world");
    t.assertDontSee("Draft post");
    expect(t.page().posts.length).toBe(1);
  });
});
```

## Full test suite example

A complete example covering the common scenarios for a login page:

```typescript
// tests/flow/LoginPage.test.ts
import { describe, test, expect } from "bun:test";
import { FlowTest } from "@zerotal/flow/testing";
import { LoginPage } from "#app/flow/LoginPage.tsx";
import { User } from "#app/models/User.ts";

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
    await t.call("login"); // no fields set

    t.assertHasErrors("email", "required");
    t.assertHasErrors("password", "required");
    t.assertNotRedirected();
  });

  test("normalises email to lowercase via onUpdated hook", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.update("email", "ALICE@EXAMPLE.COM");

    expect(t.page().email).toBe("alice@example.com");
  });

  test("flashes error after too many attempts", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.set("email", "alice@example.com");
    await t.set("password", "wrong");

    for (let i = 0; i < 5; i++) {
      await t.call("login");
    }

    t.assertFlashed("error", "Too many");
  });
});
```

## Testing events

To test that a component dispatches events and that `@on` listeners respond, mount each component separately and verify the dispatch effect:

```typescript
test("dispatches post-created when saved", async () => {
  const editor = await FlowTest.mount(PostEditorPage);
  await t.set("title", "My post");
  await t.set("body", "Content here");
  await t.call("save");

  editor.assertDispatched("post-created", { title: "My post" });
});

test("post list responds to post-created event", async () => {
  await Post.create({ title: "Existing post", status: "published" });

  const list = await FlowTest.mount(PostListPage);
  expect(list.page().posts.length).toBe(1);

  // Simulate the event arriving (same as calling the @on listener):
  await list.call("handlePostCreated", { id: 99, title: "New post" });

  // The listener called this.refresh() — posts re-loaded:
  expect(list.page().posts.length).toBe(2);
});
```

## Testing redirects and navigation

```typescript
test("redirects to the created post after save", async () => {
  const t = await FlowTest.mount(NewPostPage);
  await t.set("title", "Hello");
  await t.set("body", "World");
  await t.call("save");

  // The URL contains the new post's ID — match with a regex
  const effects = t.effects();
  expect(effects.redirect).toMatch(/^\/posts\/\d+$/);

  // Or use the assertion helper for an exact URL
  // t.assertRedirectedTo("/posts/1");
});
```

## FlowTest assertions

| Method                               | Asserts                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `t.assertSee(text)`                  | Rendered HTML contains `text`                                   |
| `t.assertDontSee(text)`              | Rendered HTML does NOT contain `text`                           |
| `t.assertHasErrors(field)`           | Validation error exists for `field`                             |
| `t.assertHasErrors(field, msg)`      | Error for `field` contains `msg` as a substring                 |
| `t.assertNoErrors()`                 | No validation errors in the error bag                           |
| `t.assertRedirectedTo(url)`          | Last action redirected to this exact URL                        |
| `t.assertNotRedirected()`            | Last action did not produce a redirect                          |
| `t.assertFlashed(level?, msg?)`      | Flash was emitted; both args are optional substrings            |
| `t.assertDispatched(event)`          | Cross-component event was dispatched                            |
| `t.assertDispatched(event, payload)` | Event was dispatched with matching payload                      |
| `t.page()`                           | Returns the component instance                                  |
| `t.html()`                           | Returns the rendered HTML string                                |
| `t.errors()`                         | Returns the error bag: `Record<string, string[]>`               |
| `t.effects()`                        | Returns drained effects (flashes, redirects, events, downloads) |
| `t.snapshot()`                       | Returns the serialised snapshot blob                            |

## Testing in a real browser

`FlowTest` never opens a socket. That is what makes it fast, and it is also what it
cannot check: whether the attribute the client needs was rendered, whether the click
listener fired, whether the frame reached the dispatcher, whether the patch came back.
A page can pass every `FlowTest` assertion and still do nothing when a person clicks it.

`FlowBrowser`, from `@zerotal/flow/browser`, closes that gap. It drives headless Chrome
over the DevTools Protocol — no Puppeteer or Playwright dependency — so the click is a
real click and the round-trip is a real round-trip.

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application, Router } from "zerotal";
import { FlowProvider } from "@zerotal/flow";
import { FlowBrowser } from "@zerotal/flow/browser";
import { CounterPage } from "../app/flow/pages/Counter.tsx";

let app: Application;
let url: string;

beforeAll(async () => {
  app = Application.create({ env: "web", providers: [FlowProvider] });
  await app.boot(); // Router.flow is a macro FlowProvider installs, so route after boot
  Router.flow("/counter", CounterPage);
  await app.start(0);
  url = `http://localhost:${(app as any)._static.port}/counter`;
}, 30_000);

// close(), not stop(): stop() ends with process.exit(0) and would kill the test run.
afterAll(async () => await app.close(), 30_000);

it("increments through the socket", async () => {
  const page = await FlowBrowser.open(url);
  try {
    await page.click("#increment");
    await page.waitForText("#count", "1");
    expect(page.consoleErrors()).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);
```

A few things are deliberate and worth copying:

- **Assert `consoleErrors()` is empty.** An action the server refuses is reported
  _only_ to the browser console — nothing reaches the server log and the page does not
  change. Without this assertion that failure is invisible to the test too.
- **Use `waitForText` / `waitUntil` rather than a sleep.** Every wait is a poll with a
  timeout, so a slow round-trip waits longer and a broken one fails naming what it was
  waiting for and what the console said.
- **Give browser tests an explicit timeout.** Bun's default is 5 s, which a browser
  launch plus a page load can exceed.
- **Guard the suite with `FlowBrowser.available()`** so it skips where no browser is
  installed instead of failing:

```ts
const describeBrowser = FlowBrowser.available() ? describe : describe.skip;
```

Set `CHROME_PATH` to pin a specific binary (this is how CI selects one).

### What to test where

| Question                                       | Tool          |
| ---------------------------------------------- | ------------- |
| Does the action compute the right state?       | `FlowTest`    |
| Does validation reject this payload?           | `FlowTest`    |
| Does the button actually reach that action?    | `FlowBrowser` |
| Does the typed value arrive at the server?     | `FlowBrowser` |
| Does the page still work after several clicks? | `FlowBrowser` |

Keep the browser tests few — a handful pinning the wiring of each critical flow — and
write the rest with `FlowTest`. They cost about a second each.

### API

| Call                               | What it does                                          |
| ---------------------------------- | ----------------------------------------------------- |
| `FlowBrowser.available()`          | Whether a browser is installed, for skipping          |
| `FlowBrowser.open(url, opts?)`     | Launch, load, and wait for Flow to connect            |
| `page.goto(url, opts?)`            | Navigate again, clearing recorded console output      |
| `page.click(sel)`                  | Real click, through the page's own delegated listener |
| `page.fill(sel, value)`            | Set a value and fire `input`/`change`, as a user does |
| `page.text(sel)`                   | An element's trimmed text                             |
| `page.value(sel)`                  | An input's current value                              |
| `page.attr(sel, name)`             | An attribute, for asserting a binding was rendered    |
| `page.html()`                      | The whole document, for diagnosing a failure          |
| `page.waitForText(sel, text, ms?)` | Poll until the text matches                           |
| `page.waitForSelector(sel, ms?)`   | Poll until the element exists                         |
| `page.waitUntil(expr, label, ms?)` | Poll until a JS expression is truthy                  |
| `page.evaluate(expr)`              | Evaluate an expression in the page                    |
| `page.consoleErrors()`             | Console errors recorded so far                        |
| `page.pageErrors()`                | Uncaught exceptions recorded so far                   |
| `page.close()`                     | Close the page and kill the browser                   |

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
