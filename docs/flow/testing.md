---
title: Testing Flow Components
description: Drive a component in-process with FlowTest, assert on its state, effects and rendered markup.
---

# Testing

`FlowTest` drives a page through the same code your running app uses — in-process, with no
server, no socket and no browser. The mount goes through the page's route handler, and every
action after it is a call frame handed to the action handler, exactly as the browser's HTTP
fallback hands it one. So a test fails where production would:

- **State is rebuilt from the snapshot on every action.** A field that is neither `@expose`d
  nor `@locked` is back at its initial value on the next request, in the test as in the app.
- **Only `@expose`d methods can be called.** Calling anything else is refused with the
  server's own error.
- **Middleware runs.** The app's middleware on the mount, and the route's middleware plus the
  persistent global ones on every action.
- **Every request has its own request scope**, with the app's container, the signed-in user
  and the URL.
- **A render that throws fails the test** with the error and its stack.

Import it from `@zerotal/flow/testing`.

## Mounting a component

`FlowTest.mount()` sends the **initial GET**: the app's global middleware and the page's route
middleware run, then the page's handler — `onBoot → onMount → onRendering → render → onRendered
→ onDehydrate` — renders it in its layout and signs the snapshot later actions start from. It
returns a test handle you can use for assertions and further interactions:

```typescript fragment
import { FlowTest } from "@zerotal/flow/testing";
import { CounterPage } from "#app/flow/CounterPage.tsx";

const t = await FlowTest.mount(CounterPage);

// Inspect initial state
expect(t.page().count).toBe(0);
t.assertSee("Count: 0");
t.assertDontSee("Count: 1");
```

When the app has been booted (with `createTestApp()`, say), `FlowTest` uses its container and
its middleware. Without one, a page runs with an empty container and no global middleware.

### The URL, route parameters and the signed-in user

The third argument says how the page is requested:

```typescript fragment
// A query string fills @url fields, as a visit does.
const search = await FlowTest.mount(PostsPage, {}, { url: "/posts?page=2&search=TypeScript" });
expect(search.page().search).toBe("TypeScript");

// A routed page is matched against its route: `/posts/:post/edit` gets `post` from the URL,
// resolved through the route's model binding, and a `@param` or same-named field receives it.
const editor = await FlowTest.mount(EditPostPage, {}, { url: "/posts/hello-world/edit" });

// Route parameters can be given directly too — a model you already have, for instance.
const direct = await FlowTest.mount(EditPostPage, {}, { url: "/posts/1/edit", params: { post } });
```

| Option    | What it does                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `url`     | Where the page is requested, query string included. Defaults to the page's route, or `/`.                    |
| `params`  | Route parameters, as the router puts them on `ctx.params`; laid over what the URL matched.                   |
| `user`    | The signed-in user (anything with an `id`), or `null` for a guest — the same as `actingAs()`.                |
| `headers` | Headers sent with the mount and every action after it.                                                       |
| `session` | Values the session holds before the visit — a password just confirmed — written by the app's session driver. |

`FlowTestMountOptions` is the type of that argument. A page routed with `Router.flow()` or a
file route keeps its route, so its middleware is the one a visitor gets; a page with no route of
its own is given a path no route serves, so it runs only the persistent global middleware.

To sign in, chain `FlowTest.actingAs(user)` before the mount. The user (a `FlowTestUser`:
anything with an `id`, your `User` model included) is put on the request before any middleware
runs, where the session middleware leaves it, so guards, `Auth.user()` and `ctx.user` all see it:

```typescript fragment
const t = await FlowTest.actingAs(alice).mount(SettingsPage);
await t.call("save");
```

The snapshot belongs to whoever the page was rendered for. `t.actingAs(bob)` on a mounted page
makes the next action Bob's, and it is refused the way a page left open across a sign-out is:
"Your session changed — reload the page."

Cookies the app sets — the session's, above all — are kept between the mount and the actions,
as a browser keeps them, including the ones an action hands over after signing someone in.

### Seeding initial state

Props passed as the second argument are assigned to the new instance before anything else
runs, `onMount()` included:

```typescript fragment
const t = await FlowTest.mount(ProjectPage, { projectId: 7 });
```

Only props on `@expose` or `@locked` fields outlive that first request — exactly as in
production, where nothing else carries a value from one request to the next. For `@url` fields,
prefer the query string, which is how a visitor sets them.

A middleware that answers the mount with a redirect (a guest sent to `/login`) is an outcome you
can assert: `t.assertRedirectedTo("/login")`. Any other refusal, or an error thrown by the page,
fails the mount.

## Calling actions

`t.call(method, ...args)` sends a **call frame** through the action handler: the page is rebuilt
from its signed snapshot, the middleware runs again, then `onBoot → onHydrate → action → onUpdate
→ onRendering → render → onRendered → onDehydrate`. The arguments travel as JSON, as the
browser sends them.

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

The full lifecycle fires on every `call()`, because it is production's own code that runs. The
method has to be `@expose`d: anything else is refused with the server's message —
`Method "purge" is not allowed` — and the test fails. A helper the page calls itself is tested
through the action that calls it, or directly on an instance.

### When an action throws

A `ValidationError` is an expected outcome: the error bag is populated, the page re-renders, and you assert on it with `assertHasErrors`.

Any other error is passed to `onError()` — by the server, as in production — and then
**rethrown**, so the test fails with the real stack. This matters because a swallowed exception
is easy to miss: in the running app the error goes to the log and the visitor gets a flash, and
otherwise the page stays as it was. A test that let it pass would see an action that ran and did
nothing.

The same goes for a render that throws, an `onBoot()` that throws, and a middleware that turns
the action away: the test fails with that error, and the page keeps the markup and snapshot the
visitor last had.

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
// update() — what the browser sends when a visitor types into a bound input:
// it goes through the @expose allowlist and fires onUpdating and onUpdated
await t.update("username", "alice");
await t.update("email", "alice@example.com");

// set() — setup: puts a value into the snapshot, then renders; no hooks fire
await t.set("draft", "Hello world");
await t.set("ownerId", 3); // @locked, which the browser could never write

// seed() — the same WITHOUT rendering, for batching
await t.seed("step", 3);
await t.seed("mode", "advanced");
await t.render(); // one render for both
```

`update()` is the one to reach for when the value is something a visitor types. It throws when
the field is not `@expose`d or is `@locked`: the server ignores such a write without a word, so
the test says so instead.

`set()` is for putting the page in a state a test needs. It rebuilds the page from its
snapshot, assigns the value, signs the result as the server would, and renders it as fast
refresh does (`onBoot → onHydrate → render`, no `onMount`). It throws for a field the snapshot
does not carry — a value there would be gone by the next action. Reach for `seed()` only when
you're assigning several properties and want to pay for a single render.

A static page (`static interactive = false`) has no snapshot and no next request. There,
`set()` and `render()` work on the instance the mount built, standing in for what `onMount()`
left on it, and `call()`/`update()` throw — a browser could not call one either.

Use `update()` when you're testing that `onUpdating`/`onUpdated` hooks run correctly:

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

```typescript
import type { Component } from "@zerotal/flow";
import { FlowTest } from "@zerotal/flow/testing";
import { parseHtml } from "@zerotal/testing";

declare const CreatePostPage: new () => Component; // your page, from app/flow/pages/

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

`assertHasErrors(field, msg?)` checks the error bag the last action sent with its patch. `msg` is a substring match on the first error message for that field.

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
t.page(); // the page as the server rebuilds it for the next action
t.html(); // the page's own markup from the last render, without the layout
t.document(); // the whole document the mount was answered with, layout and <head> included
t.errors(); // the error bag the last action sent: Record<string, string[]>
t.effects(); // what the last action did: { flashes, redirectUrl, events, downloads, … }, or null
t.frames(); // every frame the server sent back for the last action, parsed, in order
t.snapshot(); // the signed snapshot the next action is sent with
```

`t.page()` is a fresh instance with the snapshot's state restored — what the next action
starts from, not the object the last one ran on. So it answers the question production asks:

```typescript fragment
await t.call("loadReport");

expect(t.page().reportId).toBe(42); // @locked: carried to the next action
expect(t.page().rows).toEqual([]); // undecorated: gone, as it is for the next request
t.assertSee("450.00"); // …though the action's own render used it
```

Read what a render showed with `assertSee()` and [`parseHtml()`](#reading-the-render), and what
the page keeps with `t.page()`.

## The request scope

Every request `FlowTest` sends — the mount, each action — runs inside its own request scope with
the app's container, as a real one does. `Auth.user()`, `ctx.user`, request-scoped pagination and
any facade that reads the request work inside the page without any setup; sign the page in with
`FlowTest.actingAs(user)` (see [above](#the-url-route-parameters-and-the-signed-in-user)).

The scope belongs to the request, so code in the test itself is outside it. Check what an action
did through what it left behind — a row in the database, the page it renders, the redirect, the
session it hands over — rather than by asking `Auth.check()` in the test.

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
    await t.update("email", "alice@example.com");
    await t.update("password", "secret123");
    await t.call("login");

    t.assertRedirectedTo("/dashboard");
    t.assertNoErrors();
  });

  test("shows error on invalid credentials", async () => {
    const t = await FlowTest.mount(LoginPage);
    await t.update("email", "alice@example.com");
    await t.update("password", "wrongpassword");
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
    await t.update("email", "alice@example.com");
    await t.update("password", "wrong");

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
  await editor.update("title", "My post");
  await editor.update("body", "Content here");
  await editor.call("save");

  editor.assertDispatched("post-created");
  const event = editor.effects()?.events.find((e) => e.name === "post-created");
  expect(event?.data).toMatchObject({ title: "My post" });
});

test("post list responds to post-created event", async () => {
  await Post.create({ title: "Existing post", status: "published" });

  const list = await FlowTest.mount(PostListPage);
  list.assertSee("Existing post");

  // Simulate the event arriving (the client calls the @on listener, which is @expose'd):
  await list.call("handlePostCreated", { id: 99, title: "New post" });

  // The listener called this.refresh() — the list re-loaded before the render:
  list.assertSee("New post");
});
```

## Testing redirects and navigation

```typescript fragment
test("redirects to the created post after save", async () => {
  const t = await FlowTest.mount(NewPostPage);
  await t.update("title", "Hello");
  await t.update("body", "World");
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
| `t.assertRedirectedTo(url)`     | Last action (or the mount) redirected to this exact URL             |
| `t.assertNotRedirected()`       | Last action did not produce a redirect                              |
| `t.assertFlashed(level?, msg?)` | Flash was emitted; both args are optional substrings                |
| `t.assertDispatched(event)`     | An event with this name was dispatched (the payload is not checked) |
| `t.page()`                      | Returns the page as rebuilt for the next action                     |
| `t.html()`                      | Returns the page's rendered HTML, without its layout                |
| `t.document()`                  | Returns the whole document the mount was answered with              |
| `t.errors()`                    | Returns the error bag: `Record<string, string[]>`                   |
| `t.effects()`                   | Returns what the last action did (flashes, `redirectUrl`, events)   |
| `t.frames()`                    | Returns the frames the server sent for the last action              |
| `t.snapshot()`                  | Returns the signed snapshot                                         |

## Testing in a real browser

`FlowTest` never opens a socket and runs no client code. That is what makes it fast, and it is
also what it cannot check: whether the attribute the client needs was rendered, whether the click
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
