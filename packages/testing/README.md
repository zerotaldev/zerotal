# @zerotal/testing

> A complete testing toolkit for Zerotal — HTTP integration tests, transactional database isolation, factories, fakes, and a data generator.

`@zerotal/testing` builds on Bun's test runner. It boots your app for real HTTP integration tests via `TestApp`, isolates each test with transactional rollback, ships database/storage assertions and model factories, and re-exports the Mail/Queue/Notification fakes so you can assert on side effects without real I/O.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add -d @zerotal/testing
```

## Usage

### A first HTTP test

`createTestApp()` boots your application on a random port and returns a `TestApp` client:

```typescript
import { describe, it, beforeAll, afterAll } from "bun:test";
import { createTestApp, type TestApp, assertDatabaseHas } from "@zerotal/testing";
import { app } from "../bootstrap/app.ts";
import { UserFactory } from "../database/factories/UserFactory.ts";

let testApp: TestApp;
beforeAll(async () => {
  testApp = await createTestApp(() => app);
});
afterAll(() => testApp.close());

describe("POST /posts", () => {
  it("creates a post for an authenticated user", async () => {
    const user = await UserFactory.create();

    const res = await testApp.actingAs(user).post("/posts", { title: "Hello", slug: "hello" });

    res.assertCreated();
    await assertDatabaseHas("posts", { slug: "hello" });
  });
});
```

### Database isolation

```typescript
import { refreshDatabase, assertDatabaseHas, assertDatabaseMissing } from "@zerotal/testing";
import { SQL } from "bun";

const db = new SQL(":memory:");

describe("User", () => {
  refreshDatabase({
    connection: db,
    setup: (c) => c`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`,
  });

  it("creates a user", async () => {
    await User.create({ email: "a@b.com" });
    await assertDatabaseHas("users", { email: "a@b.com" });
  }); // ← rolled back; next test starts clean
});
```

### Fakes — assert on side effects

```typescript
import { MailFake } from "@zerotal/testing";

let mailer: MailFake;
beforeEach(() => {
  mailer = MailFake.install();
});
afterEach(() => mailer.restore());

it("sends a welcome email", async () => {
  await UserRegistrationService.register({ email: "alice@example.com" });
  mailer.assertSent(WelcomeMail);
});
```

### Resetting framework state

```typescript
import { resetTestState } from "@zerotal/testing";

afterEach(() => resetTestState()); // createTestApp()/testApp.close() call this for you
```

## Exports

The package exposes two subpaths:

### `@zerotal/testing` (`.`)

| Export                                                              | Kind           | Description                                                                                       |
| ------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `createTestApp`, `TestApp`                                          | helper / class | Boot the app and drive HTTP requests (`actingAs`, `get`/`post`/…).                                |
| `TestResponse`                                                      | class          | Fluent assertions on responses (`assertCreated`, `assertOk`, …).                                  |
| `withDatabase`                                                      | helper         | Run a callback against a temporary connection.                                                    |
| `refreshDatabase`                                                   | helper         | Suite-level transactional rollback. Type: `RefreshDatabaseOptions`.                               |
| `resetTestState`                                                    | helper         | Dispose the `Application` and clear router/ORM observers/global scopes.                           |
| `assertDatabaseHas`, `assertDatabaseMissing`, `assertDatabaseCount` | assertions     | Row-level database assertions.                                                                    |
| `assertStoredFile`, `assertMissingFile`                             | assertions     | Storage assertions.                                                                               |
| `Factory`, `FactoryBatch`                                           | classes        | Model factories. Type: `FactoryPayload`.                                                          |
| `fake`                                                              | object         | Random data generator for arranging state.                                                        |
| `MailFake`, `QueueFake`, `NotificationFake`                         | fakes          | In-memory fakes re-exported from `@zerotal/mail`, `@zerotal/queue`, and `@zerotal/notifications`. |

### `@zerotal/testing/preload` (`./preload`)

A preload module (`bun test --preload @zerotal/testing/preload`) that auto-wires the DB connection per test worker from `ZT_DB_URL`, so `withDatabase()` and `DB.table()` work without manual `beforeAll` setup.

## Documentation

- [Testing overview](../../docs/testing/index.md)
- [HTTP Tests](../../docs/testing/http.md)
- [Console Tests](../../docs/testing/console.md)
- [Browser Tests](../../docs/testing/browser.md)
- [Database Testing](../../docs/testing/database.md)
- [Mocking & Fakes](../../docs/testing/mocking.md)
