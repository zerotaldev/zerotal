---
title: Seeding
description: Populate your database with repeatable test and demo data through ORM-aware seeder classes.
---

# Seeding

Seeders populate your database with test or demo data. They work through your
[ORM](/docs/orm) models and pair naturally with [Factories](/docs/orm/factories),
which generate realistic records.

Reach for a seeder whenever you need a known starting state: a fresh developer
checkout that needs sample content, a demo environment, or the baseline rows a test
suite expects. Unlike [migrations](/docs/migrations), seeders are **not** tracked —
nothing records that they've run, so running one twice inserts the data twice. Design
each seeder to be safe to re-run (wipe first, or check before inserting) and you can
reset your local database to a clean, populated state any time.

Seeding ships as part of [`@zerotal/orm`](/docs/orm) — there is no separate
package to install or provider to register. Once the ORM is set up, the
`make:seeder` and `db:seed` commands are available.

## Getting Started

Seeding ships with `@zerotal/orm`. If you have the [database](/docs/database)
set up there is nothing further to install:

```typescript
import { Seeder } from "@zerotal/orm";
```

Run `bun zt db:seed` to execute every seeder in `database/seeders/`.

## Creating a seeder

```bash
# in your project root
bun zt make:seeder UserSeeder
```

This creates `database/seeders/UserSeeder.ts`. Every seeder extends `Seeder` and
implements `run()`:

```ts
// database/seeders/UserSeeder.ts
import { Seeder } from "@zerotal/orm";

export class UserSeeder extends Seeder {
  async run(): Promise<void> {
    // seed logic here
  }
}
```

`run()` is the one method you implement, and it's called once when the seeder runs.
Put your inserts here — create records through your models or factories exactly as you
would in application code. Because seeders run through the ORM, casts, hooks, and
relationships all behave normally:

```ts fragment
// database/seeders/UserSeeder.ts
import { Seeder } from "@zerotal/orm";
import { User } from "../../app/models/User.ts";

export class UserSeeder extends Seeder {
  async run(): Promise<void> {
    // A predictable admin account you can always log in with locally
    await User.create({ name: "Admin", email: "admin@example.com", password: "secret" });
  }
}
```

## Root seeder

Create a `DatabaseSeeder` that coordinates all other seeders. Use `this.call()`
to run child seeders — they execute in order inside a single transaction, so if
any fails, every change rolls back atomically.

`bun zt db:seed` wraps the whole run in a transaction too, so a seeder that does
its work inline rather than delegating to `call()` is just as atomic. Nesting is
fine: `call()` inside the outer transaction becomes a savepoint, and an inner
failure still rolls back independently. Where there is no database connection
bound at all — a seeder that writes fixtures to disk, say — the run is left
alone rather than failing for want of a transaction it never needed.

```ts fragment
// database/seeders/DatabaseSeeder.ts
import { Seeder, DB } from "@zerotal/orm";
import { UserSeeder } from "./UserSeeder.ts";
import { PostSeeder } from "./PostSeeder.ts";
import { TagSeeder } from "./TagSeeder.ts";

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // Wipe existing data in FK order before re-seeding
    await DB.raw("DELETE FROM comments");
    await DB.raw("DELETE FROM posts");
    await DB.raw("DELETE FROM users");

    await this.call([UserSeeder, TagSeeder, PostSeeder]);
  }
}
```

Order matters: seed dependencies before dependents (users before posts).

> **Danger** — `DB.raw("DELETE FROM …")` permanently removes rows. Only wipe data
> in a seeder you run against development or test databases, never in production.

## Running seeders

```bash
# in your project root
bun zt db:seed
```

The command looks for `database/seeders/DatabaseSeeder.ts`, instantiates it, and
calls `run()`. `DatabaseSeeder` is the single entry point — `db:seed` always runs that
one class, so it's the seeder you keep up to date as your app grows.

There's no flag to run an individual seeder. When you only want a subset during
development, comment out the seeders you don't need from the `this.call([...])` array,
or call one directly from a throwaway script. In tests, instantiate and run a seeder
yourself (`await new UserSeeder().run()`) to set up just the rows that test needs — see
[Database Testing](/docs/testing/database).

> **Note** — If no `DatabaseSeeder.ts` is found, `db:seed` falls back to a legacy
> `database/seeders/index.ts` that default-exports an async function. Prefer the
> class-based `DatabaseSeeder` for new projects.

## Using factories in seeders

[Factories](/docs/orm/factories) are the cleanest way to generate seed records.
Define them once, then call them from a seeder's `run()`:

```ts fragment
// database/seeders/PostSeeder.ts
import { Seeder } from "@zerotal/orm";
import { UserFactory } from "../factories/UserFactory.ts";
import { PostFactory } from "../factories/PostFactory.ts";

export class PostSeeder extends Seeder {
  async run(): Promise<void> {
    const authors = await UserFactory.count(10).create();

    for (const author of authors) {
      await PostFactory.for(author).count(5).create();
    }
  }
}
```

Here `UserFactory.count(10).create()` inserts ten authors, and `PostFactory.for(author)`
attaches each batch of posts to one of them — a quick way to build realistic related
data without hand-writing foreign keys. Factories also keep seeders short and readable:
the seeder says _how much_ data to make, the factory decides _what each record looks
like_.

See [Factories](/docs/orm/factories) for defining factories, the full API
(`create`, `make`, `count`, `for`, `state`, `afterCreate`, …), and the `fake` data
helper.

## Testing

Set your suite up once as described in [Testing](/docs/testing). A seeder is a
class with a `run()` method, so testing one is just calling it:

```typescript fragment
// tests/seeders/RoleSeeder.test.ts
import { test } from "bun:test";
import { assertDatabaseCount, assertDatabaseHas } from "@zerotal/testing";
import { RoleSeeder } from "../../database/seeders/RoleSeeder.ts";

test("seeds the three baseline roles", async () => {
  await new RoleSeeder().run();

  await assertDatabaseCount("roles", 3);
  await assertDatabaseHas("roles", { name: "admin" });
});
```

**Test that re-running is safe.** A seeder that a colleague runs twice — or that
a deploy runs on every release — must not double its rows. This is the failure
seeders actually have:

```typescript fragment
// tests/seeders/RoleSeeder.test.ts
test("running twice does not duplicate rows", async () => {
  await new RoleSeeder().run();
  await new RoleSeeder().run();

  await assertDatabaseCount("roles", 3);
});
```

If that fails, the seeder needs `updateOrCreate` rather than `create`.

**`call()` wraps its children in one transaction**, so a test for a composite
seeder can assert the all-or-nothing behaviour directly — make a late child throw
and check that the earlier one left nothing behind:

```typescript fragment
// tests/seeders/DatabaseSeeder.test.ts
test("a failing child rolls the whole run back", async () => {
  await expect(new DatabaseSeeder().run()).rejects.toThrow();

  await assertDatabaseCount("users", 0);
});
```

> **Note** — Factories used inside a seeder stay silent: model observers and
> hooks do not fire. That is deliberate, so seeding a thousand users doesn't send
> a thousand emails. See [Testing](/docs/orm#testing) in the ORM guide if you need
> the lifecycle to run.

## References

The `Seeder` base class, imported from `@zerotal/orm`:

| Member | Signature                                            | Description                                                                                  |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `run`  | `abstract run(): Promise<void>`                      | Your seed logic. Implement this on every seeder.                                             |
| `call` | `call(seeders: (new () => Seeder)[]): Promise<void>` | Run the given seeder classes in order inside one transaction; any throw rolls them all back. |

Related commands:

| Command                   | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `bun zt make:seeder Name` | Scaffold `database/seeders/Name.ts` extending `Seeder`. |
| `bun zt db:seed`          | Run `database/seeders/DatabaseSeeder.ts`.               |

## Next steps

- [Factories](/docs/orm/factories) — generating realistic model records.
- [Database Testing](/docs/testing/database) — seeding and resetting state in tests.
- [Migrations](/docs/migrations) — the schema your seeders populate.
