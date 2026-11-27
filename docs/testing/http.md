---
title: HTTP Tests
description: Boot your real application and exercise it over real HTTP requests with chainable response assertions.
---

# HTTP Tests

HTTP tests boot your real application on a random port and exercise it over real
requests. `createTestApp()` returns a `TestApp` client; every request returns a
chainable `TestResponse` for assertions.

## Getting Started

The testing helpers ship in `@zerotal/testing`. There is no provider to register
and no config file — you import the helpers directly inside your test files.

```bash
# in your project root
bun add -d @zerotal/testing
```

```typescript
// src/tests/PostTest.ts
import { createTestApp, type TestApp } from "@zerotal/testing";
```

## Booting the app

Boot the app once per suite and close it when the suite finishes:

```typescript fragment
// src/tests/PostTest.ts
import { describe, it, beforeAll, afterAll } from "bun:test";
import { createTestApp, type TestApp } from "@zerotal/testing";
import { app } from "../bootstrap/app.ts";

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp(() => app);
});

afterAll(() => testApp.close());
```

`createTestApp()` boots the app and starts it on an OS-assigned port (port `0`):

```typescript fragment
function createTestApp(
  bootstrap: () => Application | Promise<Application>,
  setup?: () => void,
): Promise<TestApp>;
```

The optional `setup` callback runs after `resetTestState()` but before `app.start()` —
use it to register routes or override bindings specific to the suite.

> **Note** — Routes registered in `setup` are compiled into the server before it
> starts, so they resolve correctly during the suite.

### One app per process

Bun runs a whole suite in a single process, and the database connection is
process-global. So when several test files each call `createTestApp()` with the same
bootstrap module, they share one booted app: the first call boots it, the rest get the
same instance back.

That means `close()` in a file's `afterAll` resets per-test state (auth, flash, captured
mail) but leaves the app running for the files still to come. Without this, the first
file's teardown closed the connection every later file depended on, and the file that
failed was a correct one that merely ran second:

```text
[Zerotal ORM] No database connection. Is DatabaseProvider registered?
```

`close()` also clears everything a file set on the client: `withHeaders()`, `withCookie()`,
`actingAs()`, `withSession()`, `followingRedirects()` and `withoutExceptionHandling()`. The next
`createTestApp()` clears it again, so a file that never calls `close()` cannot hand its
`X-Inertia: true` to the file that runs after it. Inside one file the state persists from test to
test, which is how a `beforeAll` configures the client; reset it in an `afterEach` with
`actingAsGuest()` and `withoutCookies()` when each test needs its own.

Keep calling `close()` in every file — it is what resets state between them. Passing a
`setup` callback opts out of sharing (routes cannot be registered twice against a
running server), and that app is torn down fully by its own `close()`. To tear the
shared app down explicitly — a global teardown, or a test asserting no timers leak —
call `closeSharedTestApps()`.

## Sending requests

```typescript fragment
// in a test
await testApp.get("/path");
await testApp.post("/path", body); // body serialized as JSON
await testApp.put("/path", body);
await testApp.patch("/path", body);
await testApp.delete("/path");
await testApp.head("/path");
await testApp.options("/path");
await testApp.request("/path", fetchInit); // raw Fetch RequestInit
```

Each method returns a `TestResponse`. The `post`, `put`, and `patch` helpers set
`Content-Type: application/json` and JSON-encode the body for you.

### Form submits

A route meant for a browser should be tested the way a browser reaches it. A JSON
`post()` does not travel the same path: form submits are what trigger the
redirect-back-with-errors branch of validation, the CSRF check, and any middleware
that reads `application/x-www-form-urlencoded`.

```typescript fragment
// in a test
const res = await testApp.postForm("/posts", { title: "Hello", published: true });

res.assertRedirect("/posts");
```

`putForm` and `patchForm` send the same body with a different method. Values are
stringified; `null` and `undefined` fields are omitted rather than sent as the
strings `"null"` and `"undefined"`.

### File uploads

`multipart()` is the only way to exercise a route that reads an uploaded file.
Build the attachments with `fakeFile`:

```typescript fragment
// in a test
import { fakeFile } from "zerotal/testing";

const res = await testApp.multipart("/avatar", {
  name: "Alice",
  avatar: fakeFile.image("avatar.png", { width: 64, height: 64 }),
});

res.assertCreated();
```

A field that takes several files, like `<input type="file" multiple>`, takes an array.
Each entry is sent as its own part under the field's name, which is what a browser
posts and what `files("photos")` reads:

```typescript fragment
await testApp.multipart("/albums", {
  photos: [fakeFile.image("a.png"), fakeFile.jpeg("b.jpg")],
});
```

The files `fakeFile` builds are real: a PNG has the PNG signature, a valid header
at the size you asked for, and compressed pixel data. That matters because the
framework never trusts what an upload claims to be — `UploadedFile.store()` and
`detectType()` sniff the leading bytes and name the stored file from what they
find. A placeholder full of zero bytes declared as `image/png` would pass a
`mimes` check and then be stored as `application/octet-stream`, so the test would
pass while the behavior it describes never happened.

| Builder                        | Produces                                             |
| ------------------------------ | ---------------------------------------------------- |
| `fakeFile.image(name, opts?)`  | A valid PNG at the given `width`/`height`.           |
| `fakeFile.jpeg(name?)`         | A JPEG with a real JFIF header.                      |
| `fakeFile.gif(name?)`          | A GIF89a image.                                      |
| `fakeFile.pdf(name?)`          | A one-page PDF.                                      |
| `fakeFile.create(name, c, t?)` | Exactly the contents you give it.                    |
| `fakeFile.sized(name, bytes)`  | Filler of an exact size, for exercising size limits. |

For a unit test that hands an `UploadedFile` straight to the code under test
without a request, build one with `UploadedFile.fake('a.png', { type, size })`.

### Authentication

```typescript fragment
// in a test

// Forge a signed session cookie so the request is treated as authenticated
await testApp.actingAs(user).get("/dashboard");

// Clear auth between tests
testApp.actingAsGuest();

// Pre-seed arbitrary session data
await testApp.withSession({ locale: "fr", flash: "saved" }).get("/profile");
```

`actingAs(user)` forges a signed session cookie containing `user_id`, reading
`session.secret` and `session.cookie` from your config. `withSession()` preserves
any `user_id` already set by `actingAs()`.

> **No users table?** `withSession()` is the whole answer, and it is the one to reach
> for when identity is not a row — an app whose login _is_ an IMAP login has no user
> to hand `actingAs()`. Seed whatever your app reads from the session and the request
> is authenticated:
>
> ```typescript fragment
> // in a test
> await testApp.withSession({ mail_wallet: { primary: "a@example.test" } }).get("/mail");
> ```
>
> Reaching past this to the session driver is the wrong layer and does not work —
> `driver.write()` is not a method, and `saveSession()` wants an id and a `Response`
> you do not have yet. Both of these encode through the app's _own_ driver, so the
> cookie always matches the format the app will read.

### Headers and redirects

```typescript fragment
// in a test
testApp.withHeaders({ "X-App-Version": "2" });
testApp.withCookie("theme", "dark");
testApp.asJson(); // Accept: application/json

// Follow Location redirects automatically (up to 10 hops)
const res = await testApp.followingRedirects().post("/login", { email, password });
res.assertOk(); // landed on the dashboard

testApp.withoutFollowingRedirects(); // restore default
```

These chain off `testApp` and stay in effect for every request after them, until
`close()` resets them.

`asJson()` is worth reaching for whenever a test asserts on a JSON body. The
framework negotiates error responses off the `Accept` header, so without it a
failed request comes back as the rendered HTML error page and the JSON assertions
have nothing to parse.

> **Warning** — Redirect following is **off** by default, so a `POST` that
> succeeds returns the `3xx` response, not the final page. Call
> `followingRedirects()` when you want to assert against the destination.

Any assertion that fails on a redirect says where it went. `assertOk()` on a request
that bounced to the login page fails with `Expected HTTP 200 but got 302.` followed by
`Redirected to "/login?next=%2Finvoices".`, so the cause is in the message rather than
in a header you have to go and print.

## When a test fails on a 500

An exception inside a route is converted to a response before the test sees it,
so the assertion reports `500` and the body is an error page. `withoutExceptionHandling()`
hands you the original instead:

```typescript fragment
// in a test
const res = await testApp.withoutExceptionHandling().get("/checkout");

expect(res.exception()).toBeInstanceOf(PaymentDeclinedError);
```

Errors are captured either way — `res.exception()` works without opting in, and a
failing assertion quotes the stack that caused the failure rather than making you
re-run the route by hand. What `withoutExceptionHandling()` adds is silence: it
skips the handler's reporting, so an expected failure stops writing a stack trace
into the test output. Call `withExceptionHandling()` to restore the default.

## TestResponse assertions

> **Note** — Every assertion is synchronous and chainable, including the body
> ones (`assertSee`, `assertJson`, `assertJsonPath`). The response body is read
> once when the `TestResponse` is built, so nothing here needs `await` — and a
> forgotten one can no longer turn a failure into an unhandled rejection.

Every request returns a `TestResponse`. Assertions are chainable and throw
descriptive errors on failure.

```typescript fragment
// in a test

// Status
res.assertStatus(200);
res.assertOk(); // 200
res.assertCreated(); // 201
res.assertNoContent(); // 204
res.assertUnauthorized(); // 401
res.assertForbidden(); // 403
res.assertNotFound(); // 404
res.assertUnprocessable(); // 422
res.assertMovedPermanently(); // 301

// Redirects
res.assertRedirect("/dashboard");

// Headers
res.assertHeader("Content-Type");
res.assertHeader("Content-Type", "application/json");
res.assertHeaderMissing("X-Debug");

// JSON body
res.assertJson({ title: "Hello" });
res.assertJsonPath("user.name", "Alice");
res.assertJsonPath("data.0.id", 1);
res.assertJsonCount(3); // top-level array
res.assertJsonCount(3, "data"); // array at body.data

// HTML body
res.assertSee("Welcome, Alice");
res.assertDontSee("Error");
res.assertBodyContains("<h1>");
res.assertSeeText("Welcome, Alice"); // ignores the markup between the words
res.assertDontSeeText("Error");

// Validation
res.assertInvalid(); // failed on something
res.assertInvalid("email"); // failed on email
res.assertInvalid(["email", "password"]);
res.assertInvalid({ email: "required" }); // and the message contains "required"
res.assertValid(); // nothing failed
res.assertValid("email");

// Auth
res.assertAuthenticated();
res.assertAuthenticatedAs(user); // or a bare id
res.assertGuest();

// Cookies
res.assertCookie("zerotal_session");
res.assertCookie("theme", "dark");
res.assertCookieMissing("remember_me");

// Session
res.assertSessionHas("user_id");
res.assertSessionHas("status", "saved");
res.assertSessionMissing("errors");
res.assertSessionHasErrors(["email"]);
res.assertSessionHasNoErrors();

// Inertia
res.assertInertia("Posts/Index");
res.assertInertia("Posts/Show", { post: { id: 1 } }); // props match partially
res.assertInertiaProp("filters");
```

To read the props themselves, name their type on `inertia()`. Nothing checks it at run time:
it says what the test expects the page to have been given, the way the page component's own
props type does, and it saves a cast on every read:

```ts
const page = res.inertia<{ posts: { id: number; title: string }[] }>();
expect(page?.props.posts).toHaveLength(2);
```

### Validation, whichever shape it arrives in

A failed validation reaches the client two different ways: an API client gets
`422` with an `errors` object, and a form submit gets a redirect with the errors
flashed to the session. `assertInvalid` reads both, so the assertion is the same
either way:

```typescript fragment
// in a test

// API client
const api = await testApp.asJson().post("/posts", {});
api.assertUnprocessable().assertInvalid(["title", "body"]);

// Form submit
const form = await testApp.postForm("/posts", {});
form.assertRedirect("/posts/create").assertInvalid(["title", "body"]);
```

`res.validationErrors()` returns the same errors as a `{ field: string[] }` record
when you want to assert on them directly.

### Sessions

Session data is decoded through the application's own `session.driver`, so
whatever format the driver writes is the format the assertions read. That is why
these need a response produced by `createTestApp()` with a session driver bound —
a `TestResponse` built by hand has nothing to decode with, and says so rather than
reporting the key as absent.

`res.session()` returns the decoded record when you want to inspect it directly.

> **Note** — `assertSessionMissing` throws when the session cannot be decoded
> rather than passing. "I could not read the session" is not evidence that the key
> is absent, and an assertion that treats it as such can never fail.

Reading the body directly:

```typescript fragment
// in a test
const data = res.json<{ id: number }>();
const html = res.text();
const code = res.status; // number
const ok = res.ok; // boolean
```

## Reading the page

A page rendered on the server — a Flow page, a view a controller returns — reaches a test as
HTML, not as a component and its props. `res.html()` parses it, and a test reads it the way a
visitor does: by its title and text, a link or a button by its role and name, a field by its
label. The markup around a value can change, the classes can change, and the test still
passes; nothing is added to the page only so a test can find it.

```typescript
// tests/projects.test.ts
import { expect, test } from "bun:test";
import type { TestApp } from "@zerotal/testing";

declare const app: TestApp; // booted in beforeAll, as in "Booting the app"

test("lists the projects", async () => {
  const page = (await app.get("/projects")).assertOk().html();

  page.assertTitle("Projects — Acme").assertSeeText("Showing 1–2 of 2 projects");
  page.assertLink("New project", "/projects/create");

  const items = page.getByRole("list", { name: "Projects" }).findAllByRole("listitem");
  expect(items.map((item) => item.get("a").text())).toEqual(["Billing", "Website"]);
});
```

The page is parsed once, the first time `html()` is called, with Bun's own `HTMLRewriter`:
no dependency, and no regular expression guessing at the markup.

### Finding what is on it

Every query comes in three shapes: `find…` returns the first match or `null`, `findAll…`
every match (possibly none), and `get…` the first match, throwing with what the page held
when there is none.

| Query                                                        | Finds                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find(selector)` / `findAll` / `get` / `count`               | Elements matching a CSS selector: tags, `#id`, `.class`, every attribute operator, the four combinators, `:not()`, `:is()`, `:has()`, `:nth-child()` and its relatives, `:checked`, `:disabled`.                                                                       |
| `findByRole(role, options?)` / `findAllByRole` / `getByRole` | Elements with a role — a `role` attribute, or the one the tag implies: `link`, `button`, `heading`, `textbox`, `checkbox`, `list`, `listitem`, `row`, `group`, `main`… `options` is a `ByRoleOptions`: `name` (the accessible name), `level` (for headings), `hidden`. |
| `findByText(text, options?)` / `findAllByText` / `getByText` | The innermost elements whose visible text is `text`. `options` is a `ByTextOptions`: `exact: false` for a case-insensitive substring, `selector` to narrow the candidates.                                                                                             |
| `findByLabel(text)` / `findAllByLabel` / `getByLabel`        | Form controls labelled `text`, by `<label>`, `aria-label` or `aria-labelledby`.                                                                                                                                                                                        |
| `field(field)`                                               | A form control by its `name`, then its `id`, then its label.                                                                                                                                                                                                           |
| `form(action?)`                                              | The form that sends to `action` — the first form with none given.                                                                                                                                                                                                      |

Text to match is a `TextMatch`: a string, compared once whitespace is collapsed, or a pattern.
The accessible name is what a screen reader announces: `aria-labelledby`, `aria-label`, a
`<label>`, an image's `alt`, the element's own text, then `title`. An icon link with
`aria-label="Edit Website"` is named "Edit Website"; a link wrapping an image is named by the
image's `alt`.

Each query returns an `HtmlElement`, which has every query and assertion the page has, scoped
to itself. `HtmlDocument` (the page) and `HtmlElement` share them through `HtmlScope`:

```typescript
import { expect } from "bun:test";
import { parseHtml } from "@zerotal/testing";

const page = parseHtml(`
  <form action="/settings/two-factor/confirm" method="post">
    <label for="code">Code</label>
    <input id="code" name="code" inputmode="numeric">
    <button type="button">Cancel</button>
    <button>Turn on</button>
  </form>`);

const form = page.form("/settings/two-factor/confirm");
expect(form.field("Code").attr("inputmode")).toBe("numeric");
// What Enter in the code field presses: the first submit button that belongs to the form.
expect(form.submitButton()?.text()).toBe("Turn on");
```

An element also reads back what it is: `tag`, `attr(name)`, `attributes()`, `text()`,
`html()`, `role()`, `name()`, `value()`, `isChecked()`, `isDisabled()`, `parent()` and
`children()`.

### Asserting on it

Every assertion returns the page (or element) it was called on, so they chain:

```typescript
import { parseHtml } from "@zerotal/testing";

parseHtml(`
  <title>Profile — Acme</title>
  <form action="/settings/profile" method="post">
    <label for="email">Email</label>
    <input id="email" name="email" value="ada@example" aria-invalid="true"
      aria-describedby="email-error">
    <p id="email-error">The email must be a valid email address.</p>
    <label><input type="checkbox" name="newsletter" checked> Send me the newsletter</label>
    <button>Save</button>
  </form>
  <a href="/settings/password">Password</a>`)
  .assertTitle(/^Profile/)
  .assertSeeText("Send me the newsletter")
  .assertDontSeeText("Two-factor")
  .assertValue("email", "ada@example")
  .assertChecked("newsletter")
  .assertFieldError("email", "must be a valid email address")
  .assertLink("Password", "/settings/password")
  .assertFormAction("/settings/profile", "POST")
  .assertCount("input", 2)
  .assertPresent("button")
  .assertMissing("table");
```

| Assertion                                                  | Passes when                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertTitle(title)`                                       | The page's `<title>` is `title`, or matches the pattern. On `HtmlDocument` only.                                                                                       |
| `assertSeeText(text)` / `assertDontSeeText(text)`          | A visitor can (or cannot) read `text` here: no scripts, styles, `<template>` or `hidden` elements, and a space where one block meets the next.                         |
| `assertValue(field, value)`                                | The field holds `value` as the page was sent: an input's `value`, a textarea's text, a select's chosen option, the checked radio of a group.                           |
| `assertChecked(field, value?)` / `assertNotChecked`        | The checkbox or radio is (or is not) checked. With `value`, the one of that name with that value.                                                                      |
| `assertFieldError(field, message?)` / `assertNoFieldError` | The field shows a validation error (containing `message`): it is `aria-invalid="true"`, with the visible text its `aria-errormessage` or `aria-describedby` points to. |
| `assertLink(name, href)`                                   | A link with that accessible name points to `href`. A path matches an absolute URL with that path.                                                                      |
| `assertFormAction(action, method?)`                        | A form sends to `action`, with that `method` (`GET` when the form names none).                                                                                         |
| `assertCount(selector, count)`                             | Exactly `count` elements match.                                                                                                                                        |
| `assertPresent(selector)` / `assertMissing(selector)`      | At least one element matches, or none does.                                                                                                                            |

A field's error is read the way assistive technology reads it, so a field whose error is only
coloured red has none to find. Wire the error to the field — `aria-invalid` and
`aria-describedby` — and the test and the screen reader both find it.

### When one fails

A failure says what was on the page instead, and what the query could have meant:

```text
Expected an element with the role "button" named "Delete", but none is here.

With the role "button":
  button "Delete Website relaunch"
  button "Sign out"

On the page "Projects — Acme":
  Projects New project Website relaunch Active Updated 2 minutes ago …
```

A missing link lists the links and where they go, a missing field lists the fields with their
names, labels and values, and a wrong count shows what did match. On a response that is not a
page, the message says so first — `The response is a 302 redirect to "/login", not a page.` —
which is usually the whole story.

### HTML from somewhere else

`parseHtml()` reads any HTML: a string, or anything with an `html()` method. That includes
the `FlowTest` that rendered one component (see [Testing Flow](/docs/flow/testing)), so a
component test asks the same questions an HTTP test does:

```typescript
import type { Component } from "@zerotal/flow";
import { FlowTest } from "@zerotal/flow/testing";
import { parseHtml } from "@zerotal/testing";

declare const LoginPage: new () => Component; // your page, from app/flow/pages/

const t = await FlowTest.mount(LoginPage);
parseHtml(t).getByLabel("Email");
```

None of this runs the page's JavaScript or applies its styles: an element is hidden when it has
`hidden`, sits in a `<template>`, or (for roles) has `aria-hidden="true"`. To click, type, and
see what a script does with the page, drive a real browser — see
[Browser Tests](/docs/testing/browser).

## Unit-testing a controller

Skip HTTP entirely for fast, focused controller tests by faking the context:

```typescript fragment
// src/tests/PostControllerTest.ts
import { HttpContext } from "zerotal";

const ctx = HttpContext.fake("http://localhost/posts/42", { method: "GET" });
ctx.params = { id: "42" };

await new PostController().show({ http: ctx });

expect(ctx.response?.status).toBe(200);
```

> **Tip** — Faking the context skips booting the server, so these controller tests
> run far faster than a full HTTP round-trip.

## Which should I use?

- **`createTestApp()` (full HTTP)** — when you need middleware, routing, sessions,
  or auth to run end to end. This is the realistic path and what most feature tests
  want.
- **`HttpContext.fake()` (unit)** — when you want to exercise one controller method
  in isolation without paying the cost of booting a server.

## References

### TestApp

| Member                               | Signature                                                | Description                                                        |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `actingAs`                           | `actingAs(user: { id: number \| string }): this`         | Forge a session cookie for `user.id`. Chainable.                   |
| `actingAsGuest`                      | `actingAsGuest(): this`                                  | Clear the auth cookie. Chainable.                                  |
| `withSession`                        | `withSession(data: Record<string, unknown>): this`       | Pre-seed session data, merged with any `actingAs` data. Chainable. |
| `withHeaders`                        | `withHeaders(headers: Record<string, string>): this`     | Merge headers into every request. Chainable.                       |
| `asJson`                             | `asJson(): this`                                         | Send `Accept: application/json`. Chainable.                        |
| `withCookie` / `withCookies`         | `(name, value): this` / `(record): this`                 | Attach cookies to every request. Chainable.                        |
| `withoutCookies`                     | `withoutCookies(): this`                                 | Drop the attached cookies. Chainable.                              |
| `followingRedirects`                 | `followingRedirects(): this`                             | Follow up to 10 `Location` redirects. Chainable.                   |
| `withoutFollowingRedirects`          | `withoutFollowingRedirects(): this`                      | Restore the default (no following). Chainable.                     |
| `withoutExceptionHandling`           | `withoutExceptionHandling(): this`                       | Capture the raw exception and return a bare `500`. Chainable.      |
| `withExceptionHandling`              | `withExceptionHandling(): this`                          | Restore normal error rendering. Chainable.                         |
| `get` / `head` / `options`           | `(url, headers?): Promise<TestResponse>`                 | Send a request with no body.                                       |
| `post` / `put` / `patch`             | `(url, body, headers?): Promise<TestResponse>`           | Send a request with a JSON body.                                   |
| `postForm` / `putForm` / `patchForm` | `(url, body?, headers?): Promise<TestResponse>`          | Send a URL-encoded form body.                                      |
| `multipart`                          | `(url, body?, headers?, method?): Promise<TestResponse>` | Send `multipart/form-data`, with files.                            |
| `delete`                             | `delete(url, headers?): Promise<TestResponse>`           | Send a `DELETE` request.                                           |
| `request`                            | `request(url, init?): Promise<TestResponse>`             | Raw Fetch-style request.                                           |
| `close`                              | `close(): Promise<void>`                                 | Stop the server and reset framework state.                         |
| `port`                               | `get port(): number`                                     | The OS-assigned port.                                              |
| `baseUrl`                            | `get baseUrl(): string`                                  | `http://localhost:{port}`.                                         |
| `app`                                | `get app(): Application`                                 | The underlying application, for resolving bindings.                |

### TestResponse

| Member                                                                              | Signature                                        | Description                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `assertStatus`                                                                      | `assertStatus(expected: number): this`           | Assert the status code.                                                                        |
| `assertOk` / `assertCreated` / `assertNoContent`                                    | `(): this`                                       | Assert `200` / `201` / `204`.                                                                  |
| `assertSuccessful`                                                                  | `(): this`                                       | Assert any `2xx`.                                                                              |
| `assertMovedPermanently`                                                            | `(): this`                                       | Assert `301`.                                                                                  |
| `assertUnauthorized` / `assertForbidden` / `assertNotFound` / `assertUnprocessable` | `(): this`                                       | Assert `401` / `403` / `404` / `422`.                                                          |
| `assertServerError`                                                                 | `(): this`                                       | Assert `500`.                                                                                  |
| `assertRedirect`                                                                    | `assertRedirect(url: string): this`              | Assert a `3xx` whose `Location` path equals `url`.                                             |
| `assertRedirectContains`                                                            | `assertRedirectContains(fragment: string): this` | Assert a `3xx` whose `Location` merely contains `fragment` — for a signed URL.                 |
| `assertHeader`                                                                      | `assertHeader(name, value?): this`               | Assert a header is present (and contains `value`).                                             |
| `assertHeaderMissing`                                                               | `assertHeaderMissing(name): this`                | Assert a header is absent.                                                                     |
| `assertJson`                                                                        | `assertJson(expected): this`                     | Assert each key in `expected` matches the JSON body.                                           |
| `assertJsonPath`                                                                    | `assertJsonPath(path, expected): this`           | Assert a dot-notation path in the JSON body.                                                   |
| `assertJsonCount`                                                                   | `assertJsonCount(count, key?): this`             | Assert an array length at the body or `key`.                                                   |
| `assertSee` / `assertBodyContains`                                                  | `(needle): this`                                 | Assert the body contains `needle`.                                                             |
| `assertDontSee`                                                                     | `assertDontSee(needle): this`                    | Assert the body does not contain `needle`.                                                     |
| `assertSeeText` / `assertDontSeeText`                                               | `(needle): this`                                 | The same, against the body with its tags stripped.                                             |
| `assertInvalid`                                                                     | `assertInvalid(fields?): this`                   | Assert validation failed, optionally on `fields`.                                              |
| `assertValid`                                                                       | `assertValid(fields?): this`                     | Assert validation did not fail.                                                                |
| `validationErrors`                                                                  | `(): Record<string, string[]> \| null`           | The errors, from the body or the session.                                                      |
| `assertAuthenticated`                                                               | `(): this`                                       | Assert the session holds a `user_id`.                                                          |
| `assertAuthenticatedAs`                                                             | `assertAuthenticatedAs(user \| id): this`        | Assert that specific user is signed in.                                                        |
| `assertGuest`                                                                       | `(): this`                                       | Assert nobody is signed in.                                                                    |
| `assertCookie`                                                                      | `assertCookie(name, value?): this`               | Assert a `Set-Cookie` (and optional value).                                                    |
| `assertCookieMissing`                                                               | `assertCookieMissing(name): this`                | Assert no such cookie is set.                                                                  |
| `assertSessionHas`                                                                  | `assertSessionHas(key, value?): this`            | Assert the session contains `key`.                                                             |
| `assertSessionMissing`                                                              | `assertSessionMissing(key): this`                | Assert the session lacks `key`.                                                                |
| `assertSessionHasErrors` / `assertSessionHasNoErrors`                               | `(fields?): this`                                | Assert flashed validation errors.                                                              |
| `session`                                                                           | `(): Record<string, unknown> \| null`            | The decoded session.                                                                           |
| `assertInertia`                                                                     | `assertInertia(component?, props?): this`        | Assert the Inertia page and a partial prop match.                                              |
| `assertInertiaProp`                                                                 | `assertInertiaProp(key, value?): this`           | Assert a single Inertia prop.                                                                  |
| `inertia`                                                                           | `inertia<P>(): InertiaPageOf<P> \| null`         | The Inertia page object (an `InertiaPage`), from either wire shape; with `P`, its props typed. |
| `exception`                                                                         | `(): unknown`                                    | The exception the request raised, if any.                                                      |
| `json`                                                                              | `json<T>(): T`                                   | Parse and return the full JSON body.                                                           |
| `text`                                                                              | `text(): string`                                 | Return the body as text.                                                                       |
| `html`                                                                              | `html(): HtmlDocument`                           | The body parsed as a page, to query and assert on — see "Reading the page".                    |
| `status` / `ok` / `headers`                                                         | getters                                          | The underlying `Response` status, `ok`, and headers.                                           |

### HtmlDocument and HtmlElement

What `res.html()` and `parseHtml()` return, and every element their queries find.

| Member                                                              | Signature                                               | Description                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `parseHtml`                                                         | `parseHtml(source: string \| { html() }): HtmlDocument` | Parse HTML, a `TestResponse`, or a `FlowTest`'s render.                |
| `title` / `assertTitle`                                             | `(): string` / `(title: TextMatch): this`               | The `<title>`, and an assertion on it. `HtmlDocument` only.            |
| `text` / `html`                                                     | `(): string`                                            | The visible text, whitespace collapsed; the markup.                    |
| `find` / `findAll` / `get` / `count`                                | `(selector: string)`                                    | By CSS selector.                                                       |
| `findByRole` / `findAllByRole` / `getByRole`                        | `(role: string, options?: ByRoleOptions)`               | By role, accessible name and heading level.                            |
| `findByText` / `findAllByText` / `getByText`                        | `(text: TextMatch, options?: ByTextOptions)`            | By visible text, innermost first.                                      |
| `findByLabel` / `findAllByLabel` / `getByLabel`                     | `(text: TextMatch)`                                     | Form controls by label.                                                |
| `field` / `form`                                                    | `(field: string)` / `(action?: string \| RegExp)`       | A control by name, id or label; a form by its action.                  |
| `assertSeeText` / `assertDontSeeText`                               | `(text: TextMatch): this`                               | The visible text contains (or lacks) `text`.                           |
| `assertValue` / `assertChecked` / `assertNotChecked`                | `(field, value?): this`                                 | A field's value, a checkbox's or radio's state.                        |
| `assertFieldError` / `assertNoFieldError`                           | `(field, message?): this`                               | A field's validation error, as `aria-invalid` and its message show it. |
| `assertLink` / `assertFormAction`                                   | `(name, href): this` / `(action, method?): this`        | Where a link or a form goes.                                           |
| `assertCount` / `assertPresent` / `assertMissing`                   | `(selector, count?): this`                              | How many elements match.                                               |
| `tag` / `attr` / `attributes` / `role` / `name` / `value`           | `HtmlElement`                                           | What one element is.                                                   |
| `isChecked` / `isDisabled` / `parent` / `children` / `submitButton` | `HtmlElement`                                           | Its state, its neighbours, and a form's default button.                |

## Next steps

- [Database](/docs/testing/database) — isolating each test's data.
- [Mocking](/docs/testing/mocking) — asserting mail/queue/notification side effects.
- [Console Tests](/docs/testing/console) — run CLI commands in-process and assert output.
- [Factories](/docs/orm/factories) — building the records a request acts on.
