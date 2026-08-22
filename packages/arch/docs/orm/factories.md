---
title: Factories
description: Generate realistic model instances on demand for seeders and tests.
---

# Factories

Factories produce model instances with realistic fake data. Define the default
shape once, then spin up one record or a thousand — in [seeders](/docs/seeding) or
[tests](/docs/testing).

## Getting Started

Factories ship in `@zerotal/testing`. There is no provider or config file —
import the `Factory` class and start defining:

```bash
# in your project root
bun add @zerotal/testing
```

```typescript
// database/factories/PostFactory.ts
import { Factory } from "@zerotal/testing";
```

## Defining a factory

Generate one with the CLI:

```bash
# in your project root
bun zt make:factory Post
```

This writes `database/factories/PostFactory.ts`. A factory is `Factory.define(Model,
definition)`, where the definition callback receives the built-in [`fake`](#the-fake-helper)
helper and returns the model's default attributes:

```typescript fragment
// database/factories/PostFactory.ts
import { Factory } from "@zerotal/testing";
import { Post } from "../../app/models/Post.ts";

export const PostFactory = Factory.define(Post, (fake) => ({
  title: fake.sentence({ words: 5 }),
  body: fake.paragraph(),
  slug: fake.string(12),
  publishedAt: fake.pastDate(),
}));
```

The definition is **type-safe** against the model's insert payload. Foreign-key
fields (anything ending in `Id`, e.g. `userId`) are optional in the definition —
supply them at create time with [`.for()`](#relating-models) or an override.

## Creating records

```typescript fragment
// in a test or seeder
// Persist one record → Promise<Post>
const post = await PostFactory.create();

// Override any attribute
const draft = await PostFactory.create({ publishedAt: null });

// Persist many → Promise<Post[]>
const posts = await PostFactory.count(20).create();
const five = await PostFactory.count(5).create({ status: "published" });

// Insert n without batch mode (also returns Post[])
const three = await PostFactory.createMany(3);

// Build in memory WITHOUT touching the database → Post
const unsaved = PostFactory.make({ title: "Preview" });
```

| Method                        | Returns        | Touches DB |
| ----------------------------- | -------------- | ---------- |
| `create(overrides?)`          | `Promise<T>`   | Yes        |
| `count(n).create(overrides?)` | `Promise<T[]>` | Yes        |
| `createMany(n, overrides?)`   | `Promise<T[]>` | Yes        |
| `make(overrides?)`            | `T`            | No         |

Override precedence is: definition defaults → relation FKs → your overrides (last
wins).

> **Tip** — Both `count(n).create()` and `createMany(n)` insert sequentially (not in
> parallel) so they stay correct on SQLite's single-write `last_insert_rowid()`.

## Relating models

`.for(parent)` injects the parent's primary key as a foreign key, derived from the
parent's class name (`User` → `userId`):

```typescript fragment
// in a test or seeder
const user = await UserFactory.create();

const post = await PostFactory.for(user).create(); // sets post.userId
const authored = await PostFactory.for(user, "authorId").create(); // custom FK column

// Chain multiple parents
const comment = await CommentFactory.for(post).for(user).create();
```

## Modifiers

All modifiers return a new factory (they don't mutate), so they compose freely and a
base factory stays reusable.

### state

Force the created instance into a model state via `forceState()` (bypassing guards
and transition callbacks — see [Lifecycle & Events](/docs/orm/lifecycle)):

```typescript fragment
// in a test or seeder
const expired = await SubscriptionFactory.state("expired").create();
```

### afterCreate

Run logic after each instance is saved — e.g. attaching related records:

```typescript fragment
// in a test or seeder
const user = await UserFactory.afterCreate(async (u) => {
  await PostFactory.for(u).count(3).create();
}).create();
```

### dispatchEvents

Factories suppress model observers and hooks by default. Opt back in when a test
needs the full lifecycle to fire:

> **Note** — Suppressing hooks keeps seeding side-effect free (no logs, emails, or
> queued jobs). Call `dispatchEvents()` to let observers and hooks run.

```typescript fragment
// in a test
// Silent — no "user registered" side effects:
await UserFactory.count(20).create();

// Fire observers/hooks so you can assert a side effect:
const user = await UserFactory.dispatchEvents().create();
Queue.assertDispatched(WelcomeEmailJob);
```

## In seeders

```typescript fragment
// database/seeders/DatabaseSeeder.ts
import { Seeder } from "@zerotal/orm";
import { UserFactory } from "../factories/UserFactory.ts";
import { PostFactory } from "../factories/PostFactory.ts";

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    const authors = await UserFactory.count(10).create();
    for (const author of authors) {
      await PostFactory.for(author).count(5).create();
    }
  }
}
```

See [Seeding](/docs/seeding) for running seeders.

## In tests

Factories are the standard way to arrange database state in a test:

```typescript fragment
// in a test
import { UserFactory } from "../../database/factories/UserFactory.ts";

test("an editor can publish", async () => {
  const editor = await UserFactory.state("editor").create();
  const post = await PostFactory.for(editor).create({ status: "draft" });
  // … act and assert
});
```

See [Database Testing](/docs/testing/database) for refreshing state between tests.

## The fake helper

The definition callback's argument is the built-in `fake` generator (also importable
as `import { fake } from "@zerotal/testing"`). A selection:

| Category   | Methods                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Primitives | `number(min?, max?)`, `float(min?, max?, decimals?)`, `boolean(trueWeight?)`, `uuid()`, `string(length?)`     |
| Picking    | `pick(arr)`, `sample(arr, n)`, `shuffle(arr)`, `maybe(value, probability?)`                                   |
| Dates      | `date(from?, to?)`, `pastDate(years?)`, `futureDate(years?)`, `isoDate(from?, to?)`, `timestamp()`            |
| People     | `firstName()`, `lastName()`, `name()`, `email(opts?)`, `phone()`                                              |
| Places     | `city()`, `province()`, `suburb()`, `streetAddress()`, `postalCode()`, `address()`                            |
| Company    | `company()`, `jobTitle()`, `department()`                                                                     |
| Text       | `word()`, `words(n?)`, `sentence(opts?)`, `sentences(n?, opts?)`, `paragraph(opts?)`, `paragraphs(n?, opts?)` |
| Web        | `title()`, `slug(text?)`, `url(opts?)`, `password(opts?)`                                                     |

You're free to ignore `fake` and use any data source you like inside the definition.

## References

The full factory surface. Every modifier returns a new factory, so chains compose
without mutating the base.

| Method           | Signature                                                             | Description                                                          |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `define`         | `Factory.define(Model, (fake) => FactoryPayload<T>): Factory<T>`      | Create a reusable factory for a model class.                         |
| `create`         | `create(overrides?: Partial<InsertPayload<T>>): Promise<T>`           | Insert one record and return it.                                     |
| `createMany`     | `createMany(n: number, overrides?): Promise<T[]>`                     | Insert `n` records sequentially without batch mode.                  |
| `make`           | `make(overrides?: Partial<InsertPayload<T>>): T`                      | Build one in-memory instance; does not touch the database.           |
| `count`          | `count(n: number): FactoryBatch<T>`                                   | Switch to batch mode; the returned `create()` yields `Promise<T[]>`. |
| `for`            | `for(model: Model, foreignKey?: string): Factory<T>`                  | Inject a parent's id as a foreign key (default `<model>Id`).         |
| `state`          | `state(stateName: string): Factory<T>`                                | Force created instances into a model state via `forceState()`.       |
| `afterCreate`    | `afterCreate(cb: (instance: T) => Promise<void> \| void): Factory<T>` | Run `cb` after each instance is saved.                               |
| `dispatchEvents` | `dispatchEvents(): Factory<T>`                                        | Let observers and hooks fire (suppressed by default).                |

> **Note** — `FactoryBatch` (returned by `count(n)`) mirrors `for`, `state`,
> `afterCreate`, and `dispatchEvents`, but its `create()` returns `Promise<T[]>`.

## Next steps

- [Seeding](/docs/seeding) — populating the database for demos and tests.
- [Database Testing](/docs/testing/database) — resetting state between tests.
- [Lifecycle & Events](/docs/orm/lifecycle) — model states that `state()` targets.
- [ORM](/docs/orm) — the models a factory builds.
