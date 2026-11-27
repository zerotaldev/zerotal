---
title: Testing Flow Components
description: Drive a component in-process with FlowTest, assert on its state, effects and rendered markup.
---

# Testing

`FlowTest` runs the full Flow server-side pipeline in-process — no running server, no WebSocket connection, no browser. It's the fastest way to write component tests and covers the complete request cycle: mount, hydrate, action, render, dehydrate.

Import it from `@zerotal/flow/testing`.

## Mounting a component

`FlowTest.mount()` drives the **initial GET** cycle: `onBoot → onMount → onRendering → render → onRendered → onDehydrate`. It returns a test handle you can use for assertions and further interactions:

```typescript fragment
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

```typescript fragment
const t = await FlowTest.mount(PostsPage, { page: 2, search: "TypeScript" });

expect(t.page().search).toBe("TypeScript");
expect(t.page().page).toBe(2);
t.assertSee("TypeScript");
```

This is equivalent to the component being navigated to with `?page=2&search=TypeScript` in the URL.

## Calling actions

`t.call(method, ...args)` drives a **WebSocket action frame**: `onBoot → onHydrate → [onUpdating/onUpdated] → action → onUpdate → onRendering → render → onRendered → onDehydrate`.

```typescript fragment
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

Any other error is passed to `onError()` — as in production — and then **rethrown**, so the test fails with the real stack. This matters because a swallowed exception is easy to miss: in the running app the error goes to the log and the visitor gets a flash, and otherwise the page stays as it was. A test that let it pass would see an action that ran and did nothing.

When the error path is what you're testing, opt in with `tolerateErrors()`:

```typescript fragment
const t = (await FlowTest.mount(CheckoutPage)).tolerateErrors();
await t.call("submit");

t.assertErrored(/payment gateway/); // or t.lastError()
t.assertFlashed("error", "Payment failed");
```

## Updating state

Three methods change a property between calls:

```typescript fragment
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

```typescript fragment
// Test that onUpdatedUsername normalises to lowercase
const t = await FlowTest.mount(ProfilePage);
await t.update("username", "ALICE");

expect(t.page().username).toBe("alice"); // hook lowercased it
```

## HTML assertions

```typescript fragment
t.assertSee("Published post"); // rendered HTML contains this string
t.assertDontSee("Error"); // rendered HTML does NOT contain this string
t.assertSee("<h1>Dashboard</h1>"); // can match HTML tags too
```

Both methods check `t.html()` — the raw rendered HTML string for this component. The check is a simple substring match, not a DOM query.

### Reading the render

To ask what a visitor would see — the text, a button by its name, a field by its label, where a
link or a form goes — parse the render with `parseHtml()` from `@zerotal/testing`. It takes the
`FlowTest` itself, and gives it every query and assertion an HTTP test has on `res.html()`
(see [Reading the page](/docs/testing/http#reading-the-page)):

```typescript fragment
import { FlowTest } from "@zerotal/flow/testing";
import { parseHtml } from "@zerotal/testing";

const t = await FlowTest.mount(CreatePostPage);
await t.call("save");

parseHtml(t)
  .assertFieldError("title", "The title field is required.")
  .assertValue("title", "")
  .getByRole("button", { name: "Publish" });
```

`parseHtml(t)` reads the latest render, so call it again after an action. A page served over HTTP
reads the same way: `(await app.get("/posts/create")).html()` is the page, layout and all.

## Validation assertions

```typescript fragment
await t.call("register"); // trigger a validation action

t.assertHasErrors("email"); // field has at least one error
t.assertHasErrors("email", "required"); // error message contains "required"
t.assertHasErrors("password", "min"); // error message contains "min"
t.assertNoErrors(); // no validation errors at all
```

`assertHasErrors(field, msg?)` checks the error bag returned from the last action. `msg` is a substring match on the first error message for that field.

## Redirect assertions

```typescript fragment
await t.call("login");

t.assertRedirectedTo("/dashboard"); // last action redirected to this URL
t.assertNotRedirected(); // last action did NOT redirect
```

## Flash assertions

```typescript fragment
await t.call("save");

t.assertFlashed("success", "Saved."); // level + message substring
t.assertFlashed("error"); // just check the level
t.assertFlashed(undefined, "Something went"); // just check the message substring
t.assertFlashed(); // any flash was emitted
```

## Event assertions

```typescript fragment
await t.call("createPost");

t.assertDispatched("post-created"); // event was dispatched

// assertDispatched() checks the name only — read the payload from effects()
const event = t.effects()?.events.find((e) => e.name === "post-created");
expect(event?.data).toMatchObject({ id: 1 });
```

## Accessors

```typescript fragment
t.page(); // the Component instance — inspect properties and call methods directly
t.html(); // the rendered HTML string from the last render
t.errors(); // current error bag: Record<string, string[]>
t.effects(); // effects from the last action: { flashes, redirectUrl, events, downloads, … }, or null
t.snapshot(); // the serialised snapshot blob
```

`t.page()` gives you the live component instance, so you can read any property:

```typescript fragment
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

```typescript fragment
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

```typescript fragment
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

```typescript fragment
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

```typescript fragment
test("dispatches post-created when saved", async () => {
  const editor = await FlowTest.mount(PostEditorPage);
  await editor.set("title", "My post");
  await editor.set("body", "Content here");
  await editor.call("save");

  editor.assertDispatched("post-created");
  const event = editor.effects()?.events.find((e) => e.name === "post-created");
  expect(event?.data).toMatchObject({ title: "My post" });
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

```typescript fragment
test("redirects to the created post after save", async () => {
  const t = await FlowTest.mount(NewPostPage);
  await t.set("title", "Hello");
  await t.set("body", "World");
  await t.call("save");

  // The URL contains the new post's ID — match with a regex
  expect(t.effects()?.redirectUrl).toMatch(/^\/posts\/\d+$/);

  // Or use the assertion helper for an exact URL
  // t.assertRedirectedTo("/posts/1");
});
```

## FlowTest assertions

| Method                          | Asserts                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `t.assertSee(text)`             | Rendered HTML contains `text`                                       |
| `t.assertDontSee(text)`         | Rendered HTML does NOT contain `text`                               |
| `t.assertHasErrors(field)`      | Validation error exists for `field`                                 |
| `t.assertHasErrors(field, msg)` | Error for `field` contains `msg` as a substring                     |
| `t.assertNoErrors()`            | No validation errors in the error bag                               |
| `t.assertRedirectedTo(url)`     | Last action redirected to this exact URL                            |
| `t.assertNotRedirected()`       | Last action did not produce a redirect                              |
| `t.assertFlashed(level?, msg?)` | Flash was emitted; both args are optional substrings                |
| `t.assertDispatched(event)`     | An event with this name was dispatched (the payload is not checked) |
| `t.page()`                      | Returns the component instance                                      |
| `t.html()`                      | Returns the rendered HTML string                                    |
| `t.errors()`                    | Returns the error bag: `Record<string, string[]>`                   |
| `t.effects()`                   | Returns drained effects (flashes, `redirectUrl`, events, downloads) |
| `t.snapshot()`                  | Returns the serialised snapshot blob                                |

## Testing in a real browser

`FlowTest` never opens a socket. That is what makes it fast, and it is also what it
cannot check: whether the attribute the client needs was rendered, whether the click
reached the server, whether the patch came back. A page can pass every `FlowTest`
assertion and still do nothing when a person clicks it.
[FlowBrowser](/docs/testing/flow-browser) drives a real browser against your app for
exactly those cases.

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

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
