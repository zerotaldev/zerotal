---
title: Testing
description: Boot your real app in tests and assert on HTTP, the database, console commands, browsers, and faked services.
---

# Testing

Zerotal ships a complete testing toolkit built on Bun's test runner. It covers HTTP
integration testing against a real running server, transactional database isolation,
console-command testing, end-to-end browser tests, in-memory service fakes, plus
[factories](/docs/orm/factories) and a data generator for arranging state.

```bash
# in your project root
bun test                       # run all test files
bun test --watch               # re-run on change
bun test src/tests/PostTest.ts # a single file
```

Everything is importable from `@zerotal/testing`, which is installed with the
default skeleton. To add it to an existing project:

```bash
# in your project root
bun add -d @zerotal/testing
```

## Setting up your app for testing

Do this once per project. Every test file — yours and the ones in the package
guides — assumes it exists.

A test needs an application that is configured for tests rather than for
development: an in-memory database, a synchronous queue, a log-driver mailer, a
known session secret. Building that inline in every file goes stale the first
time you add a provider, so build it once in `tests/helpers.ts` and import it
everywhere:

```typescript
// tests/helpers.ts
import { Application } from "zerotal";
import { DatabaseProvider } from "@zerotal/orm";
import { SessionProvider } from "@zerotal/session";
import { AuthProvider } from "@zerotal/auth";
import { createTestApp, type TestApp } from "@zerotal/testing";

export function createApp(setup?: () => void): Promise<TestApp> {
  return createTestApp(
    () =>
      Application.create({ env: "test" })
        .register([DatabaseProvider, SessionProvider, AuthProvider])
        .useConfig({
          database: { url: ":memory:" },
          session: { driver: "cookie", secret: "test-secret", cookie: "session", ttl: 7200 },
          queue: { driver: "sync", connection: ":memory:" },
        }),
    setup,
  );
}
```

The API template scaffolds this file for you. Add a provider to your app and you
add it here too — that one edit keeps every test in the suite honest.

From then on a test is two lines of setup:

```typescript fragment
// tests/http/posts.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("lists posts", async () => {
  const app = await createApp();

  const res = await app.get("/posts");

  res.assertOk();
  await app.close();
});
```

> **Note** — `createTestApp(bootstrap, setup?)` takes a **bootstrap callback**,
> not an application. It resets framework state, calls your callback, adopts the
> result as the current app, runs `setup`, and starts the server on a random
> port. Calling it without the callback will not compile.

Add a `test` script so the suite runs the same way everywhere:

```json
// package.json
{
  "scripts": {
    "test": "bun test"
  }
}
```

`bun zt test` runs the same files with `APP_ENV=test` already set, which is
what you want when a test boots the app through your own `bootstrap/app.ts`
rather than through `createApp()`.

## The toolkit

| Area                                   | What it covers                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| [HTTP Tests](/docs/testing/http)       | Boot the app, send requests, assert on `TestResponse`; forms, uploads, auth, session. |
| [Console Tests](/docs/testing/console) | Run CLI commands in-process with `Artisan.call()` and assert output/exit code.        |
| [Browser Tests](/docs/testing/browser) | End-to-end Playwright tests against a live server (Flow/Inertia UIs).                 |
| [Database](/docs/testing/database)     | Migrations, transactional rollback per test, and `assertDatabase*`.                   |
| [Mocking](/docs/testing/mocking)       | Event/queue/notification/broadcast/storage/HTTP fakes, the test clock, and `fake`.    |
| [Flow Tests](/docs/flow/testing)       | Drive a component's own lifecycle in-process — no server, no browser.                 |
| [Admin Tests](/docs/admin/testing)     | Mount a panel resource's List / View / Form pages with resource-aware assertions.     |

## Which test should I write?

- **Asserting on a route's status, body, or side effects?** Reach for an
  [HTTP test](/docs/testing/http) — it exercises the full request lifecycle through
  a real server.
- **Testing a form or a file upload?** Still an HTTP test, but send it the way a
  browser does: [`postForm()` or `multipart()`](/docs/testing/http), not a JSON
  `post()`. A JSON body does not travel the same path.
- **Asserting on rows after an action?** Pair the HTTP test with the
  [`assertDatabase*` helpers](/docs/testing/database) and per-test rollback.
- **Testing a CLI command?** Use [Console tests](/docs/testing/console) to run it
  in-process and assert on its output.
- **Testing what a Flow component does?** Use [Flow tests](/docs/flow/testing) —
  they drive the component's real lifecycle without a server or a browser, which
  is much faster than the HTTP or browser route.
- **Verifying a rendered UI end-to-end?** Use [Browser tests](/docs/testing/browser).
- **Need to confirm an email/job/notification/event happened without it happening?**
  Install a [fake](/docs/testing/mocking) and assert on what it captured.
- **Behaviour that depends on time passing?** Freeze the clock with
  [`Carbon.freeze()`](/docs/testing/mocking#time) instead of waiting.

## Generating a test

```bash
# in your project root
bun zt make:test PostTest         # tests/feature/PostTest.ts
bun zt make:test SlugTest --unit  # tests/unit/SlugTest.ts
```

The feature stub boots the app through `tests/helpers.ts`, so a generated test
runs against the same configured application as the rest of the suite rather than
building its own.

## A first test

`createTestApp()` boots your application, starts it on a random port, and returns a
`TestApp` client. Pair it with a [factory](/docs/orm/factories) to arrange data:

```typescript fragment
// tests/Feature/PostTest.ts
import { describe, it, beforeAll, afterAll } from "bun:test";
import { createTestApp, migrateDatabase, type TestApp, assertDatabaseHas } from "@zerotal/testing";
import { app } from "../bootstrap/app.ts";
import { UserFactory } from "../database/factories/UserFactory.ts";

let testApp: TestApp;
beforeAll(async () => {
  testApp = await createTestApp(() => app);
  await migrateDatabase(); // build the schema from database/migrations
});
afterAll(() => testApp.close());

describe("POST /posts", () => {
  it("creates a post for an authenticated user", async () => {
    const user = await UserFactory.create();

    const res = await testApp.actingAs(user).post("/posts", { title: "Hello", slug: "hello" });

    res.assertCreated();
    await assertDatabaseHas("posts", { slug: "hello" });
  });

  it("rejects a post with no title", async () => {
    const user = await UserFactory.create();

    const res = await testApp.actingAs(user).asJson().post("/posts", { slug: "hello" });

    res.assertUnprocessable().assertInvalid("title");
  });
});
```

See [HTTP Tests](/docs/testing/http) for the full `TestApp` and `TestResponse` API.

> **Tip** — `createTestApp(bootstrap, setup?)` takes an optional second callback
> that runs after the reset but before the server starts — register test-only
> routes there so they compile into the server.

## Arranging data

- **[Factories](/docs/orm/factories)** — generate model records (`Factory.define`, `create`, `for`, `state`, `count`).
- **[Seeding](/docs/seeding)** — seed reusable fixtures shared by dev and tests.
- **[Database](/docs/testing/database)** — keep tests isolated with per-test rollback.

## Resetting framework state

```typescript fragment
// tests/Feature/SomeTest.ts
import { resetTestState } from "@zerotal/testing";

afterEach(() => resetTestState());
```

`resetTestState()` disposes the current `Application` and clears the `Router`, ORM
observers, global scopes, and state-machine callbacks, plus framework event
subscriptions. `createTestApp()` and `testApp.close()` call it for you, so suites
using those helpers don't need the explicit `afterEach`.

## Running the suite from a script

A script that gates on the tests has to read the tests' exit status, and a pipe hides it:

```bash
bun test 2>&1 | tail -3     # the status is tail's. Always 0, however the suite went.
```

The suite is verbose enough that piping it somewhere is the natural thing to write, which
is what makes this worth saying: a deploy script written that way prints `1 fail` and
carries straight on to upload and restart. Nothing is wrong with the output — it is the
`$?` behind it that belongs to the last command in the pipe.

Either turn the pipe honest, or do not pipe:

```bash
set -o pipefail             # bash/zsh: the pipeline fails if any stage does
bun test 2>&1 | tail -3

# or keep the status and the output separately
bun test > test.log 2>&1 || { tail -20 test.log; exit 1; }
```

`set -e` alone does not cover it — the pipeline succeeded, as far as the shell is
concerned.

## References

The most-used members exported from `@zerotal/testing`. Each area's page documents
its full surface.

| Member                  | Signature                                                                                        | Description                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `createTestApp`         | `(bootstrap: () => Application \| Promise<Application>, setup?: () => void) => Promise<TestApp>` | Boot the app on a random port and return a client.   |
| `TestApp#actingAs`      | `(user: { id: number \| string }) => this`                                                       | Authenticate subsequent requests as `user`.          |
| `TestApp#post`          | `(url: string, body: unknown, headers?) => Promise<TestResponse>`                                | Send a JSON POST request.                            |
| `TestApp#close`         | `() => Promise<void>`                                                                            | Stop the server and reset state; call in `afterAll`. |
| `assertDatabaseHas`     | `(table: string, where: Record<string, unknown>) => Promise<void>`                               | Assert a matching row exists.                        |
| `assertDatabaseMissing` | `(table: string, where: Record<string, unknown>) => Promise<void>`                               | Assert no matching row exists.                       |
| `assertDatabaseCount`   | `(table: string, expected: number, where?) => Promise<void>`                                     | Assert the row count for a table.                    |
| `migrateDatabase`       | `(options?: MigrateDatabaseOptions) => Promise<string[]>`                                        | Build the schema from the project's migrations.      |
| `refreshDatabase`       | `(options?: RefreshDatabaseOptions) => void`                                                     | Wrap each test in a transaction and roll back.       |
| `resetTestState`        | `() => void`                                                                                     | Dispose the app and clear framework/ORM state.       |
| `Factory.define`        | `(Model, (f) => FactoryPayload<T>) => Factory<T>`                                                | Define a reusable model factory.                     |
| `fake`                  | `typeof fake`                                                                                    | South-African-flavoured random data generator.       |
| `fakeFile`              | `typeof fakeFile`                                                                                | Real PNG/JPEG/GIF/PDF files for upload tests.        |

## Next steps

- [HTTP Tests](/docs/testing/http) — the full `TestApp` and `TestResponse` API.
- [Database Tests](/docs/testing/database) — migrations and per-test rollback.
- [Console Tests](/docs/testing/console) — run CLI commands in-process.
- [Mocking](/docs/testing/mocking) — fakes for events, queue, notifications, broadcasts, storage, and outbound HTTP, plus the test clock.
- [Flow Tests](/docs/flow/testing) — drive a component in-process, with no server.
- [Admin Tests](/docs/admin/testing) — mount a panel resource's pages.
