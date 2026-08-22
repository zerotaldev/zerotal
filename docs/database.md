---
title: Database
description: Talk to your database directly — transactions, raw queries, replicas, and locks — beneath the ORM.
---

# Database

The `DB` facade is Zerotal's raw, model-free database layer — the escape hatch beneath the
[ORM](/docs/orm). Use it for transactions, fluent queries against arbitrary tables, raw SQL,
read/write replica routing, multiple connections, and advisory locks. Anything that touches
models lives in the [ORM docs](/docs/orm); anything that talks to the database directly lives
here.

Everything starts from a single import. Bring in the `DB` facade wherever you need
direct database access — a controller, a service, a seeder, or a job:

```typescript
// in a controller, service, or seeder
import { DB } from "@zerotal/orm";
```

The `DB` facade ships with `@zerotal/orm` and is wired up by the same `DatabaseProvider` —
there is no separate package to install or provider to register. See
[ORM](/docs/orm) for adding the package.

## When to reach for it

Most day-to-day data access should go through a model — you get relations, casts, and
hooks for free. Drop down to the `DB` facade when a model is the wrong tool or simply
isn't there:

- **Transactions** that span several models or mix model and raw queries — `DB.transaction()`
  is the one entry point that wraps everything inside it (see below).
- **Tables without a model** — pivot tables, reporting views, queue rows — where
  hydrating a model buys you nothing.
- **Bulk writes** where you want to skip model events and lifecycle hooks for speed.
- **Raw SQL** for the rare query a fluent builder can't express — window functions,
  CTEs, database-specific syntax.
- **Infrastructure concerns** — replica routing, multiple connections, advisory locks,
  and N+1 detection all live here because they're cross-cutting, not model-specific.

Everything the `DB` facade returns is a plain row object, never a model instance. If you
need a hydrated model back, query through the model and pass the transaction along — see
[Transactions](#transactions) for how the active connection flows automatically.

## Configuration

The database connection lives in `config/database.ts`. Use the `DatabaseConfig()` helper so
every field stays type-checked while literal values stay inferred:

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "zerotal";

export default DatabaseConfig({
  driver: "postgres",
  url: env("DATABASE_URL", "./database/db.sqlite"),
  // `env()` with no fallback is `string | undefined`, and an unset replica should
  // drop out rather than become an empty connection string.
  replicas: [env("REPLICA_1_URL"), env("REPLICA_2_URL")].filter((url) => url !== undefined),
});
```

| Field         | Required | Default                            | Description                                                                                     |
| ------------- | -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `driver`      | no       | `"sqlite"`                         | Database driver: `"sqlite"`, `"postgres"`, or `"mysql"`.                                        |
| `url`         | no       | `"./database/db.sqlite"`           | Connection URL. For SQLite use a raw file path or `:memory:` (no protocol).                     |
| `replicas`    | no       | `[]`                               | Read-replica URLs. When set, reads round-robin across them (see below).                         |
| `pool`        | no       | `{ max: 10, idleTimeout: 30 }`     | Pool tuning (`max`, `idleTimeout` in seconds) — PostgreSQL/MySQL only.                          |
| `sqlite`      | no       | `{ path: "./database/db.sqlite" }` | SQLite-specific options. `path` may be `:memory:`.                                              |
| `synchronize` | no       | `false`                            | Auto-sync schema to models at boot. Hard-off in production. See [Migrations](/docs/migrations). |

> **Note** — The container binds the active connection under the `db` key. `DatabaseProvider`
> creates it lazily on first use (`onRegister`), opens it and detects the dialect on boot
> (`onBooting`), and closes it on `onStopping` so nothing leaks between test suites.

> **Danger** — For SQLite do **not** prefix the URL with `sqlite://`. Bun's native SQLite
> driver expects a raw file path or `:memory:`; a protocol prefix is silently treated as a
> PostgreSQL connection string.

## Transactions

A transaction makes a group of writes all-or-nothing: they commit together or, if
anything throws, none of them land. Reach for one whenever a single logical operation
touches more than one row or table and a half-finished state would be a bug — money
transfers, creating an order with its line items, anything with an invariant across
tables.

Three styles, in order of preference:

- **`DB.transaction(callback)`** — the default. The boundary is the callback; commit and
  rollback are automatic. Use it for essentially everything.
- **Nested `DB.transaction()`** — when an inner step should be able to fail without
  taking down the whole operation. Backed by SAVEPOINTs.
- **`DB.beginTransaction()`** — manual `commit()`/`rollback()` only when the boundary
  can't fit in a callback (e.g. it spans an HTTP stream). You own the error handling.

### Automatic commit/rollback

Pass a callback to `DB.transaction()`. Bun commits on resolve and rolls back on throw — you never call commit/rollback manually:

```typescript fragment
// in a controller or service
import { DB } from "@zerotal/orm";

await DB.transaction(async (trx) => {
  const sender = await User.query(trx).where("id", senderId).lockForUpdate().firstOrFail();
  const recipient = await User.query(trx).where("id", recipientId).lockForUpdate().firstOrFail();

  if (sender.balance < amount) {
    throw new Error("Insufficient balance");
  }

  await User.query(trx).where("id", senderId).decrement("balance", amount);
  await User.query(trx).where("id", recipientId).increment("balance", amount);

  await Transfer.query(trx).create({ senderId, recipientId, amount });
});
// Committed — or rolled back automatically if the block threw
```

All `Model` and `DB` queries made inside the callback automatically use the transaction connection via `AsyncLocalStorage` — you don't need to pass `trx` explicitly unless you're mixing raw `DB.table()` calls with model calls:

```typescript fragment
// in a service
await DB.transaction(async () => {
  // These automatically use the transaction without passing trx:
  const user = await User.findOrFail(userId);
  user.balance -= amount;
  await user.save();

  await AuditLog.create({ userId, action: "debit", amount });
});
```

### Nested transactions

Nested `DB.transaction()` calls automatically use SAVEPOINTs. An inner throw rolls back only the inner block, not the entire outer transaction:

```typescript fragment
// in a service
await DB.transaction(async () => {
  await Order.create({ userId, total });

  try {
    await DB.transaction(async () => {
      // Attempts to send a confirmation email
      await EmailQueue.create({ to: user.email, template: "order-confirmation" });
      // If this throws, only the inner block is rolled back
      await externalEmailService.send(/* … */);
    });
  } catch {
    // Outer transaction continues — order was still created
    await Log.create({ message: "Email queuing failed", orderId: order.id });
  }
});
```

### Retry on deadlock

Pass the number of attempts as a second argument to retry automatically on deadlock or serialization failures:

```typescript fragment
// in a service
await DB.transaction(async () => {
  // critical concurrent write
}, 3); // retry up to 3 times on deadlock
```

Zerotal detects `deadlock`, `serialization failure`, `could not serialize`, `sqlite_busy`,
`database is locked`, and SQLSTATE `40001` / `40P01` in error messages across all three drivers.

### Manual transactions

For cases where the transaction boundary can't be expressed as a callback (e.g., spanning an HTTP response stream):

```typescript
// in a service
import { DB } from "@zerotal/orm";

const t = await DB.beginTransaction();
try {
  await t.table("accounts").where("id", 1).decrement("balance", 100);
  await t.table("accounts").where("id", 2).increment("balance", 100);
  await t.commit();
} catch (err) {
  await t.rollback();
  throw err;
}
```

The `ManualTransaction` handle returned by `DB.beginTransaction()`:

| Member          | Description                                            |
| --------------- | ------------------------------------------------------ |
| `t.sql`         | The raw transaction connection (tagged-template usage) |
| `t.table(name)` | Returns a `QueryBuilder` bound to this transaction     |
| `t.commit()`    | Commit and release the transaction                     |
| `t.rollback()`  | Roll back and release the transaction                  |

> **Warning** — Prefer `DB.transaction(callback)`. Manual transactions require careful error handling to avoid leaving connections open.

## Raw queries with DB

### Fluent builder

`DB.table("name")` opens a query builder on any table — no model required. The same
chain handles all four CRUD operations: call a read terminal like `get()` to fetch
rows, or a write method like `insert()`, `update()`, or `delete()` to change them.
Values are always parameterised for you, so there's no injection risk:

```typescript fragment
// in a controller or service
import { DB } from "@zerotal/orm";

// SELECT — read rows, optionally typed with get<T>()
const rows = await DB.table("posts")
  .where("user_id", userId)
  .orderBy("created_at", "desc")
  .get<{ id: number; title: string }>();

// INSERT — add a row
await DB.table("post_tags").insert({ post_id: 1, tag_id: 3 });

// UPDATE — scope with where() first, or you'll update every row
await DB.table("users").where("id", 1).update({ last_login: new Date().toISOString() });

// DELETE — same rule: always constrain with where()
await DB.table("sessions").where("user_id", userId).delete();
```

The full builder surface — joins, grouping, aggregates, pagination, and more — is
documented in [Query Builder](/docs/query-builder).

### DB.raw

Use when the query builder doesn't cover what you need.

> **Danger** — Always parameterise values; never interpolate them directly into the SQL string. String interpolation opens a SQL injection hole.

```typescript fragment
// in a service
import { DB } from "@zerotal/orm";

// String form with ? placeholders (safe)
const rows = await DB.raw<{ count: number }>(
  "SELECT COUNT(*) as count FROM posts WHERE user_id = ?",
  [userId],
);

// Tagged-template form (equally safe, more readable)
const tagged = await DB.raw<{ count: number }>`
  SELECT COUNT(*) as count FROM posts WHERE user_id = ${userId}
`;

// No parameters
const [{ version }] = await DB.raw<{ version: string }>("SELECT version()");
```

### JSON column queries

`whereJson` takes the column and a JSON path joined with `->`, then the value to match:

```typescript fragment
// in a service
// Equivalent SQL: WHERE meta->>'notifications.email' = ?
await DB.table("settings").whereJson("meta->notifications.email", true).get();
```

> **Note** — The column and path must match `/^[a-zA-Z_][a-zA-Z0-9_.]*$/`. An unsafe identifier
> throws rather than risk injection. A column with no `->` falls back to a plain `where`.

## Read/write replicas

Configure replicas in `config/database.ts`:

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "zerotal";

export default DatabaseConfig({
  url: env("DATABASE_URL", "./database/db.sqlite"),
  // `env()` with no fallback is `string | undefined`, and an unset replica should
  // drop out rather than become an empty connection string.
  replicas: [env("REPLICA_1_URL"), env("REPLICA_2_URL")].filter((url) => url !== undefined),
});
```

No model code changes needed. Routing is automatic:

| Query type                                                | Connection            |
| --------------------------------------------------------- | --------------------- |
| `SELECT`, `WITH`, `EXPLAIN`, `PRAGMA`, `SHOW`, `DESCRIBE` | Replica (round-robin) |
| `INSERT`, `UPDATE`, `DELETE`, DDL                         | Primary               |
| `BEGIN` / `DB.transaction()`                              | Primary always        |

### Force primary for read-your-writes

After a write, the replica may lag. Use `DB.onPrimary()` when you need to read the just-written data immediately:

```typescript fragment
// in a controller
const post = await Post.create({ title: "Hello", userId });

// Read from primary to avoid replication lag:
const fresh = await DB.onPrimary().table("posts").where("id", post.id).first<Post>();
```

## N+1 detection

Automatically enabled outside production (the `onBooted` hook turns on `warn` mode with a
threshold of 5). When the same SQL shape fires more than 5 times in one request, Zerotal logs a
warning.

The detector reads the **bindings**, not just the SQL text, because the same SQL repeated is
two different bugs with two different fixes:

| What it saw                       | What it means                      | What it tells you                                                            |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Same SQL, **different** arguments | A per-row lookup — the classic N+1 | Eager-load the relation, or collapse it into `whereIn`                       |
| Same SQL, **same** arguments      | The same answer fetched repeatedly | Ask once: [`RequestContext.remember`](/docs/context#asking-once-per-request) |

Without the bindings the two are indistinguishable, and a legitimate loop over six months —
identical SQL, a different `period` each time — got sent hunting for a relation to eager-load
that did not exist. `NPlusOneError.distinctArgs` carries the count if you want to branch on it.

### Configuring the detector

Tune the detector once at boot. Lower the `threshold` to catch leaks sooner, and set
`mode: "throw"` in CI so an N+1 query fails the test suite instead of just logging:

```typescript fragment
// bootstrap/app.ts — or a service provider
DB.preventNPlusOne({
  threshold: 3, // warn after 3 repetitions instead of 5
  mode: "throw", // 'warn' (default) | 'throw' — throw in CI to fail tests
});
```

### Suppressing known patterns

Some repetition is intentional — a polling endpoint, an audit log — and you don't want
the detector crying wolf. Call `allowNPlusOne` to silence a specific table, either for
good or just for the current request:

```typescript fragment
// in a service provider or request handler
// Suppress permanently for a table/pattern
DB.allowNPlusOne("activity_logs");

// Suppress only for the current request
DB.allowNPlusOne("taggings", { once: true });
```

The `pattern` argument is matched as a substring of the SQL query shape, so `"activity_logs"` matches any query against that table.

## Multiple database connections

Register named connections in a service provider and opt models into them via `static connection`:

```typescript
// in AppServiceProvider.onBooting()
import { Model } from "@zerotal/orm";

Model.registerConnection(
  "analytics",
  Bun.sql(Bun.env.ANALYTICS_DB_URL!),
  "postgres", // dialect: 'sqlite' | 'postgres' | 'mysql'
);

Model.registerConnection("warehouse", Bun.sql(Bun.env.WAREHOUSE_DB_URL!), "postgres");
```

With the connection registered, set `static connection` on any model that should live
there. From then on every query that model makes — reads, writes, pagination — is routed
to that connection with no extra arguments:

```typescript fragment
// app/models/AnalyticsEvent.ts
export class AnalyticsEvent extends Model {
  static connection = "analytics";

  @column("string") eventType!: string;
  @column("datetime") occurredAt!: Carbon;
}

// All queries use the 'analytics' connection automatically:
const events = await AnalyticsEvent.query()
  .where("event_type", "pageview")
  .orderBy("occurred_at", "desc")
  .paginate(50, 1);
```

Connection resolution priority (highest to lowest):

1. Active `DB.transaction()` / ALS transaction context
2. `RequestContext._transaction` (request-scoped transaction)
3. `static connection` named connection
4. Default `db` connection (bound by `DatabaseProvider`)

## PostgreSQL advisory locks

Use advisory locks for application-level mutual exclusion — e.g. preventing two workers from processing the same job simultaneously:

```typescript fragment
// in a job or worker
import { DB } from "@zerotal/orm";

// The callback runs with the lock held; the lock releases automatically on resolve or throw
await DB.advisoryLock(42, async () => {
  const job = await Queue.query().where("status", "pending").first();
  if (!job) return;

  await job.update({ status: "processing" });
  await processJob(job);
  await job.update({ status: "done" });
});
```

The key is an integer — use a consistent scheme (e.g. constants or hash of a resource ID) to avoid collisions across your codebase. Advisory locks are session-scoped in PostgreSQL and released automatically when the connection closes.

## Events emitted

The database layer publishes framework events on the synchronous `FrameworkEvents`
instrumentation bus — subscribe to them for logging, metrics, or tracing. Register a handler
from a service provider:

| Event                   | Emitted when                    | Payload                                                       |
| ----------------------- | ------------------------------- | ------------------------------------------------------------- |
| `QueryExecuted`         | After every SQL query completes | `sql`, `bindings`, `startMs`, `durationMs`, `rowCount`, `ctx` |
| `TransactionStarted`    | A transaction begins            | `txId`, `ctx`                                                 |
| `TransactionCommitted`  | A transaction commits           | `txId`, `durationMs`, `ctx`                                   |
| `TransactionRolledBack` | A transaction rolls back        | `txId`, `durationMs`, `reason`, `ctx`                         |
| `NPlusOneDetected`      | The N+1 detector fires          | `fingerprint`, `count`, `ctx`                                 |
| `MigrationRan`          | A migration runs up or down     | `name`, `direction`, `durationMs`, `ok`, `error?`             |

For example, subscribe to `QueryExecuted` in a provider to surface slow queries in your
logs — the handler receives the SQL, its bindings, and how long it took:

```typescript fragment
// in a service provider
import { FrameworkEvents } from "zerotal";
import { QueryExecuted } from "@zerotal/orm";

// Log slow queries
FrameworkEvents.on(QueryExecuted, (e) => {
  if (e.durationMs > 100) {
    logger.warn(`Slow query (${e.durationMs}ms): ${e.sql}`);
  }
});
```

This is the same `FrameworkEvents` bus used for HTTP, cache, and job instrumentation —
distinct from the application `Events` bus. See [Events](/docs/events) for the full catalogue,
the handler contract, and how to subscribe from a provider.

## References

The `DB` facade surface:

| Method                     | Signature                                                                | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `DB.table`                 | `table(name: string): QueryBuilder`                                      | Start a fluent query against a table on the active connection.            |
| `DB.raw`                   | `raw<T>(sql: TemplateStringsArray \| string, ...rest): Promise<T[]>`     | Execute raw SQL via tagged template or `?`-placeholder string.            |
| `DB.transaction`           | `transaction<T>(cb: (tx?) => Promise<T>, attempts?: number): Promise<T>` | Run `cb` in a transaction; auto-commit/rollback, optional deadlock retry. |
| `DB.beginTransaction`      | `beginTransaction(): Promise<ManualTransaction>`                         | Begin a transaction with manual `commit()`/`rollback()` control.          |
| `DB.onPrimary`             | `onPrimary(): { table(name): QueryBuilder }`                             | Query the primary connection, bypassing replicas (read-your-writes).      |
| `DB.currentTx`             | `currentTx(): unknown \| undefined`                                      | The active transaction connection for this call site, if any.             |
| `DB.advisoryLock`          | `advisoryLock<T>(key: number, cb: () => Promise<T>): Promise<T>`         | Hold a PostgreSQL advisory lock for the duration of `cb`.                 |
| `DB.preventNPlusOne`       | `preventNPlusOne(options?: NPlusOneOptions): void`                       | Configure N+1 detection (`threshold`, `mode`).                            |
| `DB.allowNPlusOne`         | `allowNPlusOne(pattern: string, options?: { once?: boolean }): void`     | Suppress N+1 warnings for queries matching `pattern`.                     |
| `Model.registerConnection` | `registerConnection(name: string, conn: SQLInstance, dialect?): void`    | Register a named connection that models opt into via `static connection`. |

## Next steps

- [ORM](/docs/orm) — models, the model query builder, relationships, and everything model-centric.
- [Query Builder](/docs/query-builder) — the fluent builder behind `DB.table()`.
- [Migrations](/docs/migrations) — evolving the schema your models depend on.
- [Events](/docs/events) — the `FrameworkEvents` instrumentation bus.
