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
  // One of 'sqlite' | 'postgres' | 'mysql', written literally: the field is that
  // union, and `env()` returns a plain string. Scaffolding writes your choice here.
  driver: "sqlite",
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

```typescript fragment
// app/models/Post.ts
import { Model, column, table } from "@zerotal/orm";

// Fluent chain (recommended for readability)
@(table("posts").withTimestamps())
export class Post extends Model {
  @column("string") title!: string;
  @column("text") body!: string;
  @column("integer") views!: number;
}

// Options object — same result
@table("posts", { timestamps: true })
export class Post extends Model {
  /* … */
}

// Override the primary key
@(table("users").primaryKey("user_id"))
export class User extends Model {
  /* … */
}
```

**Available chain methods and options:**

| Chain method           | Option (`@table(name, {…})`) | Effect                                                 |
| ---------------------- | ---------------------------- | ------------------------------------------------------ |
| `.withTimestamps()`    | `timestamps: true`           | Enables `created_at` / `updated_at` (default on).      |
| `.withoutTimestamps()` | `timestamps: false`          | Disables automatic timestamp management.               |
| `.primaryKey("col")`   | `primaryKey: "col"`          | Changes the primary key column name (default: `"id"`). |

> **Chain methods need the outer parentheses.** Decorator syntax allows a call at the end
> of the chain, not in the middle of it, so `@table("x").withoutTimestamps()` is a **parse
> error** — `Expected "class" but found "."`. Write `@(table("x").withoutTimestamps())`, or
> use the options object, which needs no parentheses. Plain `@table("x")` is fine as-is.

Timestamps are **on by default**, so `@table("ledger")` alone still writes `created_at` and
`updated_at`. For an append-only table whose migration creates neither column, say so —
otherwise the first save fails with `table ledger has no column named updated_at`:

```typescript fragment
@(table("ledger").withoutTimestamps())
export class LedgerEntry extends Model {
  /* … */
}
```

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
> mixin: `class Post extends Model.using(SoftDeletes) {}`. It adds `deletedAt`, `restore()`,
> `forceDelete()`, `trashed()`, and the `withTrashed()` / `onlyTrashed()` scopes. See
> [Lifecycle & Events](/docs/orm/lifecycle).

### @column decorator

Declare typed columns. Accepts a shorthand cast string or a full options object:

```typescript fragment
// in a model class body
import { column } from "@zerotal/orm";

// Shorthand (most common)
@column("string")   name!:      string;
@column("integer")  views!:     number;
@column("boolean")  active!:    boolean;
@column("datetime") createdAt!: Carbon;
@column("date")     birthday?:  Date;   // native Date — not Carbon; see below
@column("json")     meta!:      Record<string, unknown>;
@column("array")    tags!:      string[];
@column("float")    score!:     number;
@column("text")     bio?:       string;
@column("encrypted") idNumber?: string; // ciphertext at rest, plaintext here

// Shorthand + options — the shorthand keeps its type and cast
@column("string", { nullable: true }) nickname?: string | null;
@column("integer", { nullable: true, default: 0 }) retries?: number | null;

// Full options object
@column({ type: "datetime", cast: "datetime" }) publishedAt?: Carbon;
@column({ type: "number", cast: "decimal:2" }) price!: string; // toFixed() — a string
```

Shorthands map to: `string`, `text`, `integer`, `number`, `float`, `boolean`, `datetime`, `date`, `json`, `array`, `encrypted`, `encrypted:json`. See [Casts & Mutators](/docs/orm/casts) for the full cast reference.

**`type` takes either vocabulary.** The _storage_ types are `string`, `text`,
`number`, `boolean`, `datetime` and `json` — what schema generation emits. The
shorthands that look like types (`integer`, `float`, `date`, `encrypted`) are
type-and-cast pairs, and writing one as a `type` resolves it the same way the string
form does:

```typescript fragment
// in a model class body
@column({ type: "integer", default: 0 }) retries!: number; // → { type: "number", cast: "integer" }
@column({ type: "encrypted", nullable: true }) idNumber?: string; // → { type: "text", cast: "encrypted" }
```

`{ type: "integer" }` used to be an error while `@column("integer")` compiled, so the
vocabulary halved exactly when a column needed `default`, `nullable` or `unique` —
which is most real columns. An explicit `cast` alongside a shorthand still wins.

`string` is a bounded VARCHAR and `text` is the unbounded TEXT type — a distinction that matters on Postgres and MySQL, where a long body in a `VARCHAR(255)` is an error rather than a slow column.

Two casts surface as a type you might not expect, so declare the property to match
what you will actually hold: `date` hydrates a **native `Date`** (only `datetime`
gives you a [Carbon](/docs/carbon)), and `decimal:N` runs `.toFixed(N)` both ways,
so it is a **string**. TypeScript cannot catch either — the decorator does not
constrain the property type — so an annotation that disagrees compiles fine and
fails at the first `.diffForHumans()` or arithmetic.

### Indexes and uniqueness

Declare constraints on the column and schema generation emits them, so `migrate:generate` produces a schema with the guarantees your application depends on rather than a bare set of columns:

```typescript fragment
@column({ unique: true }) idempotencyKey!: string;   // unique index
@column({ index: true })  status!: string;           // plain index
```

Generated migrations also add an index to any column whose name ends in `_id` (`customerId` → `customer_id`), since an unindexed foreign key is a table scan on every join. The reference itself can't always be inferred; the index can.

### Composing model mixins

Reusable model behaviour ships as **mixins** — soft deletes, state machines, the auth contract,
roles, permissions, notifications, tenancy, auditing. A model opts into the ones it wants with the
`Model.using(...)` static, so a model that does not use a feature does not carry its API:

```typescript fragment
import { Model, SoftDeletes } from "@zerotal/orm";
import { Authenticatable, Roles, Permissions } from "@zerotal/auth";

@table("users")
export class User extends Model.using(Authenticatable, Permissions, Roles) {
  @column() email!: string;
}

@table("posts")
export class Post extends Model.using(SoftDeletes) {
  @column() title!: string;
}
```

Mixins fold left to right, and the composed class keeps the full Active Record static surface —
`User.query()`, `find()`, `create()`, scopes — plus every mixin's instance and static members,
fully typed. Prefer this over hand-nesting (`Roles(Permissions(AuthUser))`), which reads
inside-out and repeats the base.

The mixins the framework ships:

| Mixin                                       | Package                  | Adds                                                       |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| [`SoftDeletes`](/docs/orm/lifecycle)        | `@zerotal/orm`           | `deletedAt`, `restore()`, `withTrashed()`, `onlyTrashed()` |
| [`State`](/docs/orm/lifecycle)              | `@zerotal/orm`           | `transitionTo()`, guarded state machines                   |
| [`Authenticatable`](/docs/authentication)   | `@zerotal/auth`          | the auth contract `Auth.attempt()` resolves against        |
| [`Roles`](/docs/authorization)              | `@zerotal/auth`          | `assignRole()`, `hasRole()`                                |
| [`Permissions`](/docs/authorization)        | `@zerotal/auth`          | `givePermissionTo()`, `can()`                              |
| [`EmailVerification`](/docs/authentication) | `@zerotal/auth`          | verification links and state                               |
| [`PasswordReset`](/docs/authentication)     | `@zerotal/auth`          | reset tokens                                               |
| [`Notifiable`](/docs/notifications)         | `@zerotal/notifications` | `notify()` and the notification channels                   |
| [`Tenantable`](/docs/tenancy)               | `@zerotal/tenancy`       | automatic per-tenant scoping                               |
| [`Auditable`](/docs/audit)                  | `@zerotal/audit`         | change history                                             |
| [`Media`](/docs/media)                      | `@zerotal/media`         | file attachments, collections, image conversions           |

#### Composing onto a shared base

`using` composes onto whatever class you call it on, not onto `Model` specifically, so an
app-level base model can carry its own configuration and still take mixins:

```typescript fragment
class AppModel extends Model {
  static override primaryKey = "uuid";
}

@table("invoices")
export class Invoice extends AppModel.using(SoftDeletes) {} // still uses "uuid"
```

The composed class carries `using` itself, so composition can also be chained —
`Model.using(A, B).using(C)`.

#### Writing your own

A mixin is a function taking a base constructor and returning a class that extends it:

```typescript
import { Model, registerColumn, type Constructor } from "@zerotal/orm";

export function Sluggable<T extends Constructor>(Base: T) {
  return class extends Base {
    slug = "";

    setSlug(from: string): this {
      this.slug = from.toLowerCase().replace(/\s+/g, "-");
      return this;
    }
  };
}

export class Article extends Model.using(Sluggable) {}
```

> **Note** — a mixin that needs to declare a real database column must call `registerColumn()`
> imperatively. The `@column` decorator cannot run inside a returned class expression.

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

```typescript fragment
// app/models/Post.ts
@table("posts")
export class Post extends Model {
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

```typescript fragment
// app/models/Post.ts
import type { Columns } from "@zerotal/orm";

static fillable: Columns<Post>[] = ["title", "body", "status"];
// TypeScript error if you list a column name that doesn't exist on Post
```

Declare `fillable` as a literal tuple (`as const`) and `create()` narrows its payload to
exactly those columns:

```typescript fragment
@table("customers")
export class Customer extends Model {
  static fillable = ["name", "email"] as const;

  @column() name!: string;
  @column() email!: string;
  // A compliance flag that must never come from a request body
  @column({ type: "boolean", cast: "boolean", default: false }) legalHold!: boolean;
}

await Customer.create({ name: "Ada", email: "ada@example.com" }); // ✓ legalHold not required
await Customer.create({ name: "Ada", email: "…", legalHold: true }); // ✗ compile error
```

Without the `as const`, the payload is the full column set, so a required non-fillable
column is demanded by the type and rejected by the runtime — a pair of rules that cannot
both be satisfied. The narrowing makes the type agree with the guard, and moves the
mistake from a runtime `MassAssignmentError` to a compile error.

### Trusted writes — forceFill, forceCreate, unguard

For data you construct yourself (seeders, factories, framework-internal writes)
the guard is just friction. Bypass it deliberately:

```typescript fragment
// Per call — skip the guard for one write:
role.forceFill({ name, guard });
await Role.forceCreate({ name, guard });

// A trusted block — guard disabled inside, restored afterwards (even on throw):
await Model.withoutGuard(() => seeder.run());

// Process-wide (e.g. a seeder entrypoint) — pair with reguard():
Model.unguard();
// … bulk trusted work …
Model.reguard();

// Or opt a single model out entirely (its writes never come from user input):
class AuditLog extends Model {
  static override unguarded = true;
}
```

An explicit `fillable` / `guarded` list is always honoured, even under a global
`unguard()` — so a model that lists its fillable columns stays protected regardless.

> **Tests:** test fixtures are trusted code that `create()` models freely, so the
> framework's test suites run with `Model.unguard()` enabled via a preload
> (`scripts/test-preload.ts`). If your app's tests build models directly rather
> than through factories, do the same, or declare `fillable` on the models.

### fill instance method

```typescript fragment
// in a controller
post.fill({ title: "New title", body: "Updated body" }); // throws if a key isn't fillable
await post.save();

// Typical controller pattern — ctx.body() is already validated and typed:
post.fill(ctx.body<UpdatePayload<Post>>());
await post.save();
```

## Password hashing

Fields listed in `hashable` are automatically hashed with `Bun.password.hash()` (bcrypt) before every `INSERT`, and on `UPDATE` only when the value has changed since the last load:

```typescript fragment
// app/models/User.ts
@table("users")
export class User extends Model {
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

```typescript fragment
// app/events/UserCreated.ts
export class UserCreated {
  constructor(public user: User) {}
}
```

```typescript fragment
// app/models/User.ts
@table("users")
export class User extends Model {
  static dispatchesEvents = {
    created: UserCreated,
    deleted: UserDeleted,
    updating: UserUpdating,
  };
}
```

**Valid event keys:** `creating`, `created`, `updating`, `updated`, `saving`, `saved`, `deleting`, `deleted`, `retrieved`.

Each event class is constructed with the model instance as its first argument and emitted on the container's event bus (a no-op when no bus is bound, so it's safe in standalone ORM use). Subscribe anywhere:

```typescript fragment
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
import { Model, column, table } from "@zerotal/orm";

@(table("posts").withTimestamps())
export class Post extends Model {
  // Models guard every attribute by default — list the mass-assignable columns.
  static fillable: string[] = ["name"];

  @column() name!: string;
}
```

## Full model example

```typescript fragment
// app/models/Post.ts
import { Model, column, table, hasMany, belongsTo } from "@zerotal/orm";
import type { Columns } from "@zerotal/orm";
import { Carbon } from "zerotal/carbon";
import type { Comment } from "./Comment.ts";
import type { User } from "./User.ts";

@(table("posts").withTimestamps())
export class Post extends Model {
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

```typescript fragment
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

```typescript fragment
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

```typescript fragment
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
