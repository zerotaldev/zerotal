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
import { fakeFile } from "@zerotal/testing";

const res = await testApp.multipart("/avatar", {
  name: "Alice",
  avatar: fakeFile.image("avatar.png", { width: 64, height: 64 }),
});

res.assertCreated();
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

These chain off `testApp` and apply to the request that follows.

`asJson()` is worth reaching for whenever a test asserts on a JSON body. The
framework negotiates error responses off the `Accept` header, so without it a
failed request comes back as the rendered HTML error page and the JSON assertions
have nothing to parse.

> **Warning** — Redirect following is **off** by default, so a `POST` that
> succeeds returns the `3xx` response, not the final page. Call
> `followingRedirects()` when you want to assert against the destination.

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

| Member                                                                              | Signature                                        | Description                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `assertStatus`                                                                      | `assertStatus(expected: number): this`           | Assert the status code.                                                        |
| `assertOk` / `assertCreated` / `assertNoContent`                                    | `(): this`                                       | Assert `200` / `201` / `204`.                                                  |
| `assertSuccessful`                                                                  | `(): this`                                       | Assert any `2xx`.                                                              |
| `assertMovedPermanently`                                                            | `(): this`                                       | Assert `301`.                                                                  |
| `assertUnauthorized` / `assertForbidden` / `assertNotFound` / `assertUnprocessable` | `(): this`                                       | Assert `401` / `403` / `404` / `422`.                                          |
| `assertServerError`                                                                 | `(): this`                                       | Assert `500`.                                                                  |
| `assertRedirect`                                                                    | `assertRedirect(url: string): this`              | Assert a `3xx` whose `Location` path equals `url`.                             |
| `assertRedirectContains`                                                            | `assertRedirectContains(fragment: string): this` | Assert a `3xx` whose `Location` merely contains `fragment` — for a signed URL. |
| `assertHeader`                                                                      | `assertHeader(name, value?): this`               | Assert a header is present (and contains `value`).                             |
| `assertHeaderMissing`                                                               | `assertHeaderMissing(name): this`                | Assert a header is absent.                                                     |
| `assertJson`                                                                        | `assertJson(expected): this`                     | Assert each key in `expected` matches the JSON body.                           |
| `assertJsonPath`                                                                    | `assertJsonPath(path, expected): this`           | Assert a dot-notation path in the JSON body.                                   |
| `assertJsonCount`                                                                   | `assertJsonCount(count, key?): this`             | Assert an array length at the body or `key`.                                   |
| `assertSee` / `assertBodyContains`                                                  | `(needle): this`                                 | Assert the body contains `needle`.                                             |
| `assertDontSee`                                                                     | `assertDontSee(needle): this`                    | Assert the body does not contain `needle`.                                     |
| `assertSeeText` / `assertDontSeeText`                                               | `(needle): this`                                 | The same, against the body with its tags stripped.                             |
| `assertInvalid`                                                                     | `assertInvalid(fields?): this`                   | Assert validation failed, optionally on `fields`.                              |
| `assertValid`                                                                       | `assertValid(fields?): this`                     | Assert validation did not fail.                                                |
| `validationErrors`                                                                  | `(): Record<string, string[]> \| null`           | The errors, from the body or the session.                                      |
| `assertAuthenticated`                                                               | `(): this`                                       | Assert the session holds a `user_id`.                                          |
| `assertAuthenticatedAs`                                                             | `assertAuthenticatedAs(user \| id): this`        | Assert that specific user is signed in.                                        |
| `assertGuest`                                                                       | `(): this`                                       | Assert nobody is signed in.                                                    |
| `assertCookie`                                                                      | `assertCookie(name, value?): this`               | Assert a `Set-Cookie` (and optional value).                                    |
| `assertCookieMissing`                                                               | `assertCookieMissing(name): this`                | Assert no such cookie is set.                                                  |
| `assertSessionHas`                                                                  | `assertSessionHas(key, value?): this`            | Assert the session contains `key`.                                             |
| `assertSessionMissing`                                                              | `assertSessionMissing(key): this`                | Assert the session lacks `key`.                                                |
| `assertSessionHasErrors` / `assertSessionHasNoErrors`                               | `(fields?): this`                                | Assert flashed validation errors.                                              |
| `session`                                                                           | `(): Record<string, unknown> \| null`            | The decoded session.                                                           |
| `assertInertia`                                                                     | `assertInertia(component?, props?): this`        | Assert the Inertia page and a partial prop match.                              |
| `assertInertiaProp`                                                                 | `assertInertiaProp(key, value?): this`           | Assert a single Inertia prop.                                                  |
| `inertia`                                                                           | `(): InertiaPage \| null`                        | The Inertia page object, from either wire shape.                               |
| `exception`                                                                         | `(): unknown`                                    | The exception the request raised, if any.                                      |
| `json`                                                                              | `json<T>(): T`                                   | Parse and return the full JSON body.                                           |
| `text`                                                                              | `text(): string`                                 | Return the body as text.                                                       |
| `status` / `ok` / `headers`                                                         | getters                                          | The underlying `Response` status, `ok`, and headers.                           |

## Next steps

- [Database](/docs/testing/database) — isolating each test's data.
- [Mocking](/docs/testing/mocking) — asserting mail/queue/notification side effects.
- [Console Tests](/docs/testing/console) — run CLI commands in-process and assert output.
- [Factories](/docs/orm/factories) — building the records a request acts on.
