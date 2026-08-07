---
title: ORM
description: Map model classes to database tables with an Active Record layer over Bun's native SQL client.
---

# ORM

Zerotal's ORM is an Active Record layer built on top of Bun's native SQL client. Each model class maps to a database table, columns are declared with decorators, and queries read fluently in TypeScript. The same model code runs on SQLite, PostgreSQL, and MySQL.

- [Casts & Mutators](/docs/orm/casts) — column types, custom casts, reactive JSON, the `static casts` map.
- [Queries](/docs/orm/queries) — the query builder, instance methods, scopes, and pagination.
- [Relationships](/docs/orm/relationships) — `belongsTo`/`hasMany`/etc., eager loading, and pivot operations.
- [Serialization](/docs/orm/serialization) — `hidden`/`visible`/`appends` and JSON output.
- [Lifecycle & Events](/docs/orm/lifecycle) — hooks, observers, state machines, `dispatchesEvents`, pruning.
- [Migrations](/docs/migrations) — evolving your tables as models change.
- [Seeding](/docs/seeding) — populating tables with factory and seeder data.

> **Note** — Working with raw SQL — transactions, the `DB` query builder, replicas, multiple connections,
> and the events the database emits — lives in [Database](/docs/database). The ORM is for
> models; the raw layer is for everything beneath them. Date/time values use [Carbon](/docs/carbon).

## Getting Started

```bash
# in your project root
bun add @zerotal/orm
```

## Register the provider

Add `DatabaseProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { DatabaseProvider } from "@zerotal/orm";

const providers = [
  // …your other providers
  DatabaseProvider,
];

export default providers;
```

Registering the provider switches on the following (in lifecycle order):

- `onRegister` — binds the `db` connection as a lazy singleton, registers model/observer auto-discovery and implicit route-model binding, and wires the connection resolver.
- `onBooting` — opens the connection, detects the SQL dialect, bridges `dispatchesEvents` to the app event bus, and registers the validator's `unique()`/`exists()` rules.
- `onBooted` — enables N+1 query detection outside production and registers the `migrate`, `make:model`, `db:seed`, and related commands.
- `onStopping` — closes the connection so nothing leaks between boots or test suites.

## Configuration

Create `config/database.ts`. Use the `DatabaseConfig()` helper so every field stays type-checked while literal values stay inferred:

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "zerotal";

export default DatabaseConfig({
  driver: env("DB_DRIVER", "sqlite"), // 'sqlite' | 'postgres' | 'mysql'
  url: env("DATABASE_URL", "./database/db.sqlite"),

  // PostgreSQL:  'postgres://user:pass@localhost:5432/mydb'
  // MySQL:       'mysql://user:pass@localhost:3306/mydb'

  replicas: [], // optional read-replica URLs; reads round-robin, writes hit primary

  pool: {
    max: env("DB_POOL_MAX", 10), // max connections (postgres/mysql)
    idleTimeout: env("DB_POOL_IDLE_TIMEOUT", 30), // seconds before idle close
  },

  sqlite: {
    path: env("DB_SQLITE_PATH", "./database/db.sqlite"), // ':memory:' for in-memory
  },
});
```

| Field              | Required | Default                  | Description                                                                            |
| ------------------ | -------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `driver`           | yes      | `"sqlite"`               | Database driver: `"sqlite"`, `"postgres"`, or `"mysql"`.                               |
| `url`              | yes      | `"./database/db.sqlite"` | Connection URL (or SQLite file path / `:memory:`).                                     |
| `replicas`         | no       | `[]`                     | Read-replica URLs. Reads round-robin to replicas; writes and transactions hit primary. |
| `pool.max`         | no       | `10`                     | Maximum pool connections (PostgreSQL / MySQL only).                                    |
| `pool.idleTimeout` | no       | `30`                     | Seconds an idle connection is kept before closing.                                     |
| `sqlite.path`      | yes      | `"./database/db.sqlite"` | SQLite file path. Use `":memory:"` for an in-memory database.                          |
| `synchronize`      | no       | `false`                  | Auto-sync the schema to your models at boot. Hard-off in production. See note below.   |

> **Danger** — For SQLite, do not use a `sqlite://` protocol prefix in `url`. Bun's native
> SQLite driver expects a raw file path or `:memory:`.

> **Warning** — `synchronize: true` performs additive schema sync (creates missing tables and
> columns) at boot and is forced off in production. Set `{ enabled: true, disruptive: true }` to
> also DROP columns no model declares anymore — this destroys their data, so keep it local/test only.

## Defining models

### @table decorator

Every model is configured with the `@table()` decorator. It accepts a fluent chain or an options object — both styles are equivalent:

```typescript
// app/models/Post.ts
import { BaseModel, column, table } from "@zerotal/orm";

// Fluent chain (recommended for readability)
@(table("posts").withTimestamps())
export class Post extends BaseModel {
  @column("string") title!: string;
  @column("text") body!: string;
  @column("integer") views!: number;
}

// Options object — same result
@table("posts", { timestamps: true })
export class Post extends BaseModel {
  /* … */
}

// Override the primary key
@(table("users").primaryKey("user_id"))
export class User extends BaseModel {
  /* … */
}
```

**Available chain methods and options:**

| Chain method           | Option (`@table(name, {…})`) | Effect                                                 |
| ---------------------- | ---------------------------- | ------------------------------------------------------ |
| `.withTimestamps()`    | `timestamps: true`           | Enables `created_at` / `updated_at` (default on).      |
| `.withoutTimestamps()` | `timestamps: false`          | Disables automatic timestamp management.               |
| `.primaryKey("col")`   | `primaryKey: "col"`          | Changes the primary key column name (default: `"id"`). |

> **Note** — **Auto-discovery:** Models under `app/models/` don't need `@table` — they're auto-registered at boot with a conventional table name (`pluralize(snake(ClassName))`, e.g. `Post` → `posts`). Use `@table` only to override the name or options.
>
> **Packages and tests:** Models defined inside packages or inline in test files always need `@table` (or `registerModel(Class)`). `@table` is the definition-time anchor that registers the queued `@column`/relation fields — without it, those fields won't register.
>
> **Subclasses that add columns** also need their own `@table`, using the same table name for single-table inheritance:
>
> ```typescript
> // app/models/Admin.ts
> @table("users")
> class Admin extends User {
>   @column("integer") level!: number; // ← won't register without @table on Admin
> }
> ```

> **Tip** — Soft deletes are **not** a `@table` option. Opt in per model with the `SoftDeletes`
> mixin: `class Post extends BaseModelWith(SoftDeletes) {}`. It adds `deletedAt`, `restore()`,
> `forceDelete()`, `trashed()`, and the `withTrashed()` / `onlyTrashed()` scopes. See
> [Lifecycle & Events](/docs/orm/lifecycle).

### @column decorator

Declare typed columns. Accepts a shorthand cast string or a full options object:

```typescript
// in a model class body
import { column } from "@zerotal/orm";

// Shorthand (most common)
@column("string")   name!:      string;
@column("integer")  views!:     number;
@column("boolean")  active!:    boolean;
@column("datetime") createdAt!: Carbon;
@column("date")     birthday?:  Carbon;
@column("json")     meta!:      Record<string, unknown>;
@column("array")    tags!:      string[];
@column("float")    score!:     number;
@column("text")     bio?:       string;

// Full options object
@column({ type: "datetime", cast: "datetime" }) publishedAt?: Carbon;
@column({ type: "number", cast: "decimal:2" }) price!: number;
```

Shorthands map to: `string`, `text`, `integer`, `number`, `float`, `boolean`, `datetime`, `date`, `json`, `array`. See [Casts & Mutators](/docs/orm/casts) for the full cast reference.

## Mass assignment

Models **guard every attribute by default.** A model that declares neither
`fillable` nor `guarded` rejects _every_ attribute passed to `create()` / `fill()`,
throwing `MassAssignmentError`. This means a stray key in a request body — a
`role`, an `is_admin`, an `id` — can never reach the database just because it was
in `ctx.body()`. To allow columns through, you opt in explicitly.

### fillable and guarded

`fillable` is an allowlist; `guarded` is a denylist. Use one or the other, not both.
Any attribute not permitted by the active list throws `MassAssignmentError` (it is
**not** silently dropped), so a mistake surfaces loudly instead of quietly failing:

```typescript
// app/models/Post.ts
@table("posts")
export class Post extends BaseModel {
  // Only these fields are accepted by create() and fill()
  static fillable = ["title", "body", "status"];

  // OR — allow everything except these fields
  static guarded = ["id", "userId"];

  @column("string") title!: string;
  @column("text") body!: string;
  @column("string") status!: string;
}
```

Use the `Columns<T>` utility for compile-time safety against typos:

```typescript
// app/models/Post.ts
import type { Columns } from "@zerotal/orm";

static fillable: Columns<Post>[] = ["title", "body", "status"];
// TypeScript error if you list a column name that doesn't exist on Post
```

### Trusted writes — forceFill, forceCreate, unguard

For data you construct yourself (seeders, factories, framework-internal writes)
the guard is just friction. Bypass it deliberately:

```typescript
// Per call — skip the guard for one write:
role.forceFill({ name, guard });
await Role.forceCreate({ name, guard });

// A trusted block — guard disabled inside, restored afterwards (even on throw):
await BaseModel.withoutGuard(() => seeder.run());

// Process-wide (e.g. a seeder entrypoint) — pair with reguard():
BaseModel.unguard();
// … bulk trusted work …
BaseModel.reguard();

// Or opt a single model out entirely (its writes never come from user input):
class AuditLog extends BaseModel {
  static override unguarded = true;
}
```

An explicit `fillable` / `guarded` list is always honoured, even under a global
`unguard()` — so a model that lists its fillable columns stays protected regardless.

> **Tests:** test fixtures are trusted code that `create()` models freely, so the
> framework's test suites run with `BaseModel.unguard()` enabled via a preload
> (`scripts/test-preload.ts`). If your app's tests build models directly rather
> than through factories, do the same, or declare `fillable` on the models.

### fill instance method

```typescript
// in a controller
post.fill({ title: "New title", body: "Updated body" }); // throws if a key isn't fillable
await post.save();

// Typical controller pattern — ctx.body() is already validated and typed:
post.fill(ctx.body<UpdatePayload<Post>>());
await post.save();
```

## Password hashing

Fields listed in `hashable` are automatically hashed with `Bun.password.hash()` (bcrypt) before every `INSERT`, and on `UPDATE` only when the value has changed since the last load:

```typescript
// app/models/User.ts
@table("users")
export class User extends BaseModel {
  static hashable = ["password"];

  @column("string") name!: string;
  @column("string") email!: string;
  @column("string") password!: string;
}

// No manual hashing needed — the ORM handles it transparently:
const user = await User.create({ name: "Alice", email: "alice@example.com", password: "secret" });

// Verify later:
const ok = await Bun.password.verify(candidate, user.password);
```

## Bridging model events to the app event bus

`dispatchesEvents` connects ORM lifecycle hooks to the application event bus without wiring every observer manually. Declare a map from lifecycle event names to event classes:

```typescript
// app/events/UserCreated.ts
export class UserCreated {
  constructor(public user: User) {}
}
```

```typescript
// app/models/User.ts
@table("users")
export class User extends BaseModel {
  static dispatchesEvents = {
    created: UserCreated,
    deleted: UserDeleted,
    updating: UserUpdating,
  };
}
```

**Valid event keys:** `creating`, `created`, `updating`, `updated`, `saving`, `saved`, `deleting`, `deleted`, `retrieved`.

Each event class is constructed with the model instance as its first argument and emitted on the container's event bus (a no-op when no bus is bound, so it's safe in standalone ORM use). Subscribe anywhere:

```typescript
// app/listeners/sendWelcome.ts
import { Events } from "zerotal";
import { UserCreated } from "#app/events/UserCreated.ts";

Events.on(UserCreated, async ({ user }) => {
  await Mail.send(new WelcomeMail(user.email));
});
```

> **Tip** — Use `dispatchesEvents` when event consumers live in separate parts of your application
> and shouldn't be coupled to the model file. For logic that lives close to the model, reach for an
> observer instead — see [Lifecycle & Events](/docs/orm/lifecycle).

## Generating models

```bash
# in your project root
bun zt make:model Post
bun zt make:model Post --migration   # also create a migration
bun zt make:model Post -m            # shorthand
```

A generated model skeleton (`app/models/Post.ts`):

```typescript
// app/models/Post.ts
import { BaseModel, column, table } from "@zerotal/orm";

@(table("posts").withTimestamps())
export class Post extends BaseModel {
  // Models guard every attribute by default — list the mass-assignable columns.
  static fillable: string[] = ["name"];

  @column() name!: string;
}
```

## Full model example

```typescript
// app/models/Post.ts
import { BaseModel, column, table, hasMany, belongsTo } from "@zerotal/orm";
import type { Columns } from "@zerotal/orm";
import { Carbon } from "zerotal/carbon";
import type { Comment } from "./Comment.ts";
import type { User } from "./User.ts";

@(table("posts").withTimestamps())
export class Post extends BaseModel {
  // Mass assignment
  static fillable: Columns<Post>[] = ["title", "body", "status", "userId"];

  // Serialization
  static appends = ["excerpt"];

  // Columns
  @column("string") title!: string;
  @column("text") body!: string;
  @column("string") status!: string;
  @column("integer") userId!: number;
  @column("integer") views!: number;
  @column("datetime") publishedAt?: Carbon;
  @column("json") meta!: Record<string, unknown>;

  // Relationships
  @belongsTo(() => User, { foreignKey: "userId" })
  author!: User;

  @hasMany(() => Comment, { foreignKey: "postId" })
  comments!: Comment[];

  // Computed accessor
  get excerpt(): string {
    return this.body.slice(0, 160) + "…";
  }
}
```

## Testing

Set your suite up once as described in [Testing](/docs/testing), and see
[Database Testing](/docs/testing/database) for rollback and the `assertDatabase*`
family. What follows is what's specific to models.

**Factories silence observers and hooks by default.** This is the single trap
worth knowing: `UserFactory.create()` writes the row without firing `creating`,
`created`, or any registered observer, so seeders don't spray logs, mail, and
jobs. A test asserting on a side-effect of creation therefore sees nothing —
and reads as a bug in your observer rather than in the test.

```typescript
// tests/models/User.test.ts
import { test } from "bun:test";
import { QueueFake } from "@zerotal/queue";
import { UserFactory } from "../../database/factories/UserFactory.ts";
import { WelcomeEmailJob } from "../../app/jobs/WelcomeEmailJob.ts";

test("creating a user queues the welcome email", async () => {
  const queue = QueueFake.install();

  // Without dispatchEvents() the observer never runs and this assertion fails.
  await UserFactory.dispatchEvents().create();

  queue.assertDispatched(WelcomeEmailJob);
});
```

**Scopes, casts, and accessors need no HTTP.** They are model behaviour, so test
them against the model directly — it is faster and the failure points at the
right line:

```typescript
// tests/models/Post.test.ts
import { test, expect } from "bun:test";
import { PostFactory } from "../../database/factories/PostFactory.ts";
import { Post } from "../../app/models/Post.ts";

test("the published scope excludes drafts", async () => {
  await PostFactory.create({ status: "published" });
  await PostFactory.create({ status: "draft" });

  const rows = await Post.query().published().get();

  expect(rows).toHaveLength(1);
});
```

**Soft deletes hide rows from the default query**, which makes "did it delete?"
ambiguous. Assert on both sides — gone from the normal query, present with
`withTrashed()`:

```typescript
// tests/models/Post.test.ts
await post.delete();

expect(await Post.find(post.id)).toBeNull();
expect(await Post.query().withTrashed().where("id", post.id).first()).not.toBeNull();
```

`assertDatabaseMissing("posts", { id })` would **fail** here, because the row is
still on disk with a `deleted_at` stamp. Use `onlyTrashed()` or assert on the
column instead.

## References

Static configuration properties read from the model class:

| Property           | Type                                | Description                                                                    |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| `table`            | `string`                            | Table name. Set by `@table` or inferred from the class name.                   |
| `primaryKey`       | `string`                            | Primary key column. Default `"id"`.                                            |
| `timestamps`       | `boolean`                           | Whether `created_at` / `updated_at` are managed. Default `true`.               |
| `fillable`         | `string[]`                          | Mass-assignment allowlist. Not permitted → `MassAssignmentError`.              |
| `guarded`          | `string[]`                          | Mass-assignment denylist (use instead of `fillable`).                          |
| `unguarded`        | `boolean`                           | Disable mass-assignment guarding for this model. Default `false` (guarded).    |
| `hashable`         | `string[]`                          | Fields auto-hashed with `Bun.password.hash()` on change.                       |
| `hidden`           | `string[]`                          | Fields omitted from JSON output. See [Serialization](/docs/orm/serialization). |
| `visible`          | `string[]`                          | Allowlist of fields included in JSON output.                                   |
| `appends`          | `string[]`                          | Computed accessors appended to JSON output.                                    |
| `dispatchesEvents` | `Record<string, new (m) => object>` | Maps lifecycle event keys to event classes emitted on the event bus.           |
| `implicitBinding`  | `boolean`                           | Set `false` to opt the model out of route-model binding.                       |

Type helpers exported from `@zerotal/orm`:

| Helper                | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `Columns<T>`          | Union of a model's column names, for typo-safe `fillable`/`hidden`. |
| `InsertPayload<T>`    | The shape accepted by `create()`.                                   |
| `UpdatePayload<T>`    | The shape accepted by `fill()` / `update()`.                        |
| `DatabaseConfigShape` | The `config/database.ts` configuration type.                        |

### Commands

`@zerotal/orm` ships the migration, model, and seeding commands. Every one runs through `bun zt`:

| Command                                    | What it does                                              |
| ------------------------------------------ | --------------------------------------------------------- |
| `bun zt migrate`                           | Run all pending database migrations (alias: `db:migrate`) |
| `bun zt migrate:rollback`                  | Roll back the most recent migration batch                 |
| `bun zt migrate:fresh`                     | Roll back every migration, then re-run them from scratch  |
| `bun zt migrate:status`                    | Show the status of each migration                         |
| `bun zt migrate:generate`                  | Auto-generate a migration from model schema changes       |
| `bun zt make:model Post --migration`       | Create a model class, optionally with a migration         |
| `bun zt make:migration create_posts_table` | Create a new migration file                               |
| `bun zt make:factory PostFactory`          | Create a new model factory                                |
| `bun zt make:seeder PostSeeder`            | Create a new database seeder class                        |
| `bun zt db:seed`                           | Run database seeders from `database/seeders/`             |

## Next steps

- [Casts & Mutators](/docs/orm/casts) — column types and custom casts.
- [Queries](/docs/orm/queries) — the query builder, scopes, and pagination.
- [Relationships](/docs/orm/relationships) — `belongsTo`, `hasMany`, eager loading.
- [Migrations](/docs/migrations) — build the tables your models map to.
