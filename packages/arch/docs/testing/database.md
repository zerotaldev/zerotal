---
title: Database Testing
description: Keep database tests isolated with per-test transactional rollback and assert on rows and stored files.
---

# Database Testing

Tests that touch the database must stay isolated — one test's writes can't leak into
the next. Zerotal wraps each test in a transaction that **rolls back** when it finishes,
and ships assertions for checking rows and stored files.

```typescript
// in a test file
import {
  migrateDatabase,
  refreshDatabase,
  withDatabase,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertDatabaseCount,
} from "@zerotal/testing";
```

> **Note** — These helpers are part of the [testing toolkit](/docs/testing) and
> only run inside `bun test`. Install the package as a dev dependency if it isn't
> already: `bun add -d @zerotal/testing`.

## Building the schema

A test needs tables before it needs rows. Build them by running the project's own
[migrations](/docs/migrations) rather than by writing the schema a second time:

```typescript
// tests/Feature/PostTest.ts
import { migrateDatabase } from "@zerotal/testing";

beforeAll(async () => {
  app = await createApp();
  await migrateDatabase();
});
```

A hand-written `CREATE TABLE` in a test is a second definition of the same tables,
and the two drift. A column added in a migration is missing from the test schema
until something fails for a reason that has nothing to do with the change you
made. Running the migrations themselves means the schema under test is the schema
that ships.

```typescript
// signature
function migrateDatabase(options?: MigrateDatabaseOptions): Promise<string[]>;
```

| Option       | Type          | Default                 | Purpose                         |
| ------------ | ------------- | ----------------------- | ------------------------------- |
| `connection` | `SQLInstance` | the active connection   | Which database to migrate.      |
| `path`       | `string`      | `"database/migrations"` | Where the migration files live. |
| `table`      | `string`      | `"migrations"`          | Tracking-table name.            |

It returns the names of the migrations it applied, and is idempotent — a second
call applies nothing. `refreshDatabase({ migrate: true })` runs it for you, which
is usually what you want:

```typescript
// in a test file
describe("Post", () => {
  refreshDatabase({ connection: db, migrate: true });
  // …the real schema, and every test rolled back after itself
});
```

For a file-backed or server test database — where migrating once up front beats
migrating per test file — `bun zt test --migrate` applies them before the suite
starts. An `:memory:` database belongs to the process that opened it, so there is
nothing for a parent process to migrate; use `refreshDatabase({ migrate: true })`
there.

## Which rollback helper do I use?

Both run your test inside a transaction that rolls back, leaving the database
untouched. Choose by scope:

- **`refreshDatabase`** — call once in a `describe` block to roll back _every_ test in
  it, and (optionally) install a connection and run schema setup once. Reach for this
  in feature suites where many tests share the same tables.
- **`withDatabase`** — wrap a _single_ `it()` body when only that one test needs
  rollback. No `describe`-level setup.

## refreshDatabase — suite-level rollback

Call it once inside a `describe` block. Every `it()` in that block runs inside a
transaction that rolls back when the test ends, so each test starts from the same
clean baseline:

```typescript
// tests/Feature/UserTest.ts
import { describe, it } from "bun:test";
import { refreshDatabase, assertDatabaseHas, assertDatabaseMissing } from "@zerotal/testing";
import { SQL } from "bun";
import { User } from "../app/models/User.ts";

const db = new SQL(":memory:");

describe("User", () => {
  refreshDatabase({ connection: db, migrate: true });

  it("creates a user", async () => {
    await User.create({ email: "a@b.com" });
    await assertDatabaseHas("users", { email: "a@b.com" });
  }); // ← rolled back; next test starts clean

  it("starts clean", async () => {
    await assertDatabaseMissing("users", { email: "a@b.com" });
  });
});
```

```typescript
// signature
function refreshDatabase(options?: RefreshDatabaseOptions): void;
```

| Option       | Type                           | Required | Purpose                                                                              |
| ------------ | ------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `connection` | `SQLInstance`                  | no       | Install as the model connection for this suite. Omit to use the existing connection. |
| `migrate`    | `boolean \| string`            | no       | Run the project's migrations first. A string names a different directory.            |
| `setup`      | `(db: SQLInstance) => unknown` | no       | Runs once before the suite and is **committed**, so every test sees it.              |
| `teardown`   | `(db: SQLInstance) => unknown` | no       | Runs once after all tests complete.                                                  |

Both `migrate` and `setup` are committed (they are the schema and any shared
fixtures), while each test's own writes happen inside the rolled-back transaction.

> **Warning** — `refreshDatabase()` only works inside a `bun test` run; it pulls
> `beforeAll`/`afterEach` from `bun:test`. Calling it outside the test runner throws.

## withDatabase — per-test wrapper

When you want rollback for a single test rather than a whole block, wrap the test body:

```typescript
// in a test file
import { withDatabase } from "@zerotal/testing";

it(
  "creates a user",
  withDatabase(async () => {
    await User.create({ email: "a@b.com" });
    await assertDatabaseHas("users", { email: "a@b.com" });
  }),
); // ← transaction rolled back here
```

```typescript
// signature
function withDatabase(fn: () => Promise<void>): () => Promise<void>;
```

A test failure inside the callback still rolls the transaction back, then re-throws so
the assertion is reported.

## Database assertions

Each assertion runs a `COUNT(*)` against the current connection and throws a
descriptive error when the expectation fails:

```typescript
// in a test file
import { assertDatabaseHas, assertDatabaseMissing, assertDatabaseCount } from "@zerotal/testing";

await assertDatabaseHas("users", { email: "alice@example.com", role: "admin" });
await assertDatabaseMissing("users", { email: "deleted@example.com" });
await assertDatabaseCount("posts", 5);
await assertDatabaseCount("posts", 2, { published: 1 }); // optional where filter
```

| Function                                | Throws when                       |
| --------------------------------------- | --------------------------------- |
| `assertDatabaseHas(table, where)`       | No row matches `where`.           |
| `assertDatabaseMissing(table, where)`   | A matching row exists.            |
| `assertDatabaseCount(table, n, where?)` | The matching row count isn't `n`. |

## Storage assertions

For tests that write to a [storage](/docs/storage) disk, assert file presence without
reading bytes. Pass a disk name or a `StorageDriver` instance:

```typescript
// in a test file
import { assertStoredFile, assertMissingFile } from "@zerotal/testing";

await assertStoredFile("local", "uploads/avatar.jpg");
await assertMissingFile("local", "uploads/old.jpg");
```

> **Note** — A disk name routes through the `Storage` facade (needs
> `StorageProvider` registered); a `StorageDriver` instance lets isolated unit tests
> skip the facade entirely.

## Arranging rows

Use [factories](/docs/orm/factories) to build the records a test acts on, and
[seeders](/docs/seeding) for shared fixtures:

```typescript
// in a test file
import { UserFactory } from "../database/factories/UserFactory.ts";
import { PostFactory } from "../database/factories/PostFactory.ts";

const editor = await UserFactory.state("editor").create();
const posts = await PostFactory.for(editor).count(3).create();
```

Factories suppress model observers by default, so seeding rows doesn't fire emails or
jobs — call `.dispatchEvents()` when a test needs the full lifecycle.

> **Tip** — `.for(editor)` injects the parent's primary key as the `<Model>Id`
> foreign key, so child rows line up with the record you created.

## References

| Function                | Signature                                                                             | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `migrateDatabase`       | `(options?: MigrateDatabaseOptions) => Promise<string[]>`                             | Build the schema by running the project's migrations.                    |
| `refreshDatabase`       | `(options?: RefreshDatabaseOptions) => void`                                          | Roll back every test in a `describe` block; optional connection + setup. |
| `withDatabase`          | `(fn: () => Promise<void>) => () => Promise<void>`                                    | Wrap one `it()` body in a transaction that always rolls back.            |
| `assertDatabaseHas`     | `(table: string, where: Record<string, unknown>) => Promise<void>`                    | Pass when at least one row matches `where`.                              |
| `assertDatabaseMissing` | `(table: string, where: Record<string, unknown>) => Promise<void>`                    | Pass when no row matches `where`.                                        |
| `assertDatabaseCount`   | `(table: string, expected: number, where?: Record<string, unknown>) => Promise<void>` | Pass when the matching row count equals `expected`.                      |
| `assertStoredFile`      | `(diskOrDriver: string \| StorageDriver, path: string) => Promise<void>`              | Pass when the file exists on the disk or driver.                         |
| `assertMissingFile`     | `(diskOrDriver: string \| StorageDriver, path: string) => Promise<void>`              | Pass when the file is absent from the disk or driver.                    |

## Next steps

- [Testing overview](/docs/testing) — the full toolkit and a first test.
- [Factories](/docs/orm/factories) — generating model records for tests.
- [Seeding](/docs/seeding) — reusable fixtures across dev and tests.
- [Database](/docs/database) — transactions and the raw `DB` layer being rolled back.
- [HTTP Tests](/docs/testing/http) — drive these rolled-back rows through real requests.
