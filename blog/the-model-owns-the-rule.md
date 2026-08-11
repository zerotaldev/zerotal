---
title: "The Model Is the Only Place the Rule Lives"
description: "An ORM's real job is not writing your SQL — it is being the one place a fact about your data is stated. Zerotal's ORM guards mass assignment by default, lets a model own its own lookup, rejects illegal state transitions, and tells you about an N+1 before your users do."
date: 2026-08-10
category: Engineering
order: 8
---

# The Model Is the Only Place the Rule Lives

Ask what an ORM is for and the usual answer is "so you don't write SQL". That undersells it, and it misdiagnoses where the pain actually is. Writing a `SELECT` is not hard. What is hard is that a single fact about your data — _drafts are invisible_, _a price has two decimal places_, _nobody sets their own role_, _a shipped order cannot go back to pending_ — gets restated in eleven places and drifts in three of them.

The interesting design question is not "how do I avoid SQL", it is **where does a rule live, and how many places have to remember it**. Zerotal's ORM has one answer throughout: the rule lives on the model, once, and everything that touches the model gets it for free.

Here is what that looks like in practice.

## The guard is on by default

Start with the rule everyone means to write and nobody does. A model guards every attribute unless you say otherwise:

```ts
@table("users")
export class User extends Model {
  @column() name!: string;
  @column() email!: string;
  @column() role!: string;
}

await User.create({ name: "Ada", email: "ada@example.com" });
// MassAssignmentError — no fillable list, so nothing is accepted
```

That looks unhelpful for about ten seconds, and then you notice what it buys. The failure mode it removes is the one that has quietly escalated privileges in every framework that ever shipped a permissive default: a request body carrying `role: "admin"`, handed to `create()` by a controller that was only thinking about `name` and `email`.

You opt columns in explicitly:

```ts
static override fillable = ["name", "email"] as const;
```

Note the `as const`. It is not decoration — it narrows `create()`'s payload type to exactly those columns:

```ts
await User.create({ name: "Ada", email: "ada@example.com" }); // ✓
await User.create({ name: "Ada", email: "…", role: "admin" }); // ✗ compile error
```

So the type and the runtime guard now agree. Without the narrowing you get the situation that makes strict defaults annoying: a required non-fillable column that TypeScript _demands_ and the guard _refuses_, two rules that cannot both be satisfied. The tuple makes the compiler enforce what the runtime was going to enforce anyway, and moves the mistake from a production `MassAssignmentError` to a red squiggle.

And when the data is yours — a seeder, a factory, a repair script — the guard is friction rather than safety, so you turn it off deliberately rather than by forgetting:

```ts
await Model.withoutGuard(() => seeder.run()); // restored afterwards, even on throw
await Role.forceCreate({ name, guard }); // one call
```

An explicit `fillable` list is honoured even inside `unguard()`, so a model that stated its rule keeps it under a global override. That is the theme: the model's declaration wins.

## The column says what it is

A cast is a rule about a value's shape, so it goes on the column rather than at every read:

```ts
@column("datetime")   publishedAt!: Carbon;          // Carbon in, ISO 8601 out
@column("json")       meta!: Record<string, unknown>;
@column("array")      tags!: string[];
@column("encrypted")  idNumber?: string;             // AES-256-GCM at rest, plaintext here
@column({ type: "number", cast: "decimal:2" }) price!: string;
```

`encrypted` is the one worth pausing on. The ciphertext is what lands in the column; the model hands you the plaintext. Nothing between those two points has to know — not your queries, not your serializer, not the developer reading the model six months from now. A column that keeps its mouth shut is one word.

`decimal:2` surfaces as a **string**, deliberately, because that is what round-tripping through `.toFixed(2)` gives you and pretending otherwise is how currency picks up floating-point drift. `date` hydrates a native `Date` while `datetime` hydrates a [Carbon](/docs/carbon). Declare the property as what you will actually hold — these are the two that surprise people, which is why the docs say so twice.

There is a small, careful decision inside `json` worth knowing about, because the obvious shortcut is wrong. `json` encodes on write and parses on read in **both** directions, including for values that are already strings. Skipping the encode for strings looks like it avoids double-encoding — but then the column holds bare characters, and `JSON.parse("62812345678")` is a _number_. A branch code stored as `"051001"` would come back having lost its leading zero. So the encode is unconditional, and a scalar round-trips as the type you gave it.

## A scope is a question you ask more than once

`where("status", "published")` in six controllers is six chances to forget it. Name it once:

```ts
@table("posts")
export class Post extends Model {
  static published = Model.scope((q) => q.whereNotNull("published_at"));
  static byAuthor = Model.scope((q, userId: number) => q.where("user_id", userId));
}
```

```ts
const posts = await Post.query()
  .withScopes((s) => {
    s.published();
    s.byAuthor(user.id);
  })
  .orderBy("published_at", "desc")
  .paginate(20);
```

And when the rule must hold for _every_ query rather than the ones that remember, a global scope applies it without touching a single call site:

```ts
Post.addGlobalScope("tenant", (q) => q.where("tenant_id", currentTenantId()));
```

That single line is the backbone of [multi-tenancy](/docs/tenancy): every query on the model is partitioned, including ones written next year by someone who has never heard of tenants. Escaping it has to be deliberate — `withoutGlobalScope("tenant")` — which is the right way round. A safety rule you can forget is not a safety rule.

## The model owns its own lookup

A slug-addressed model is the standard case, and the standard implementation is a `where("slug", …)` copy-pasted into every controller, Flow page, and file route that resolves one. State it once instead:

```ts
static async resolveRouteBinding(value: string): Promise<Post> {
  return Post.query().where("slug", value).firstOrFail() as Promise<Post>;
}
```

Now `/posts/:post` resolves by slug — in a controller, in a [Flow page](/docs/flow/routing), in a file route — and a missing record raises `ModelNotFoundError`, which the HTTP layer renders as a 404 _before your handler runs_. The handler receives a loaded record and writes only the happy path. No lookup, no null check, no 404 branch.

It receives the request context and the name of the segment that matched, so one model can answer differently for `/users/:user` and `/users/:username/posts` without knowing either route's shape. Scoping the lookup to the current tenant, or to published posts only, is a line in the same method — and every route that binds the model inherits it.

## Illegal transitions are refused, not saved

Some columns are not really values, they are positions in a workflow. `status` is the usual one, and `order.status = "pending"` on a shipped order is the usual bug: perfectly valid TypeScript, perfectly valid SQL, completely wrong.

Declare the graph and the wrong assignment stops being expressible:

```ts
const States = {
  draft: { canTransitionTo: ["review", "archived"] as const },
  review: { canTransitionTo: ["published", "draft"] as const },
  published: { canTransitionTo: ["archived"] as const },
  archived: { canTransitionTo: [] as const },
} as const;

@(table("posts").withTimestamps())
export class Post extends Model.using(State) {
  static states = States;
  @column("string") status!: keyof typeof States;
}
```

```ts
await post.transitionTo("review"); // ✓
await post.transitionTo("published"); // ✓
await post.transitionTo("draft"); // ✗ StateError — surfaces as a 422
```

Guards run before a state is entered, so "you cannot activate a subscription with no Stripe ID" is enforced at the transition rather than checked in whichever controller happens to remember. `onTransition("published", …)` fires afterwards for the mail and the search-index sync, and a `"*"` listener catches every move for the audit trail.

`forceState()` exists for data-repair scripts and seeders, and **throws in production**. An escape hatch that cannot be reached by accident from a live request is the only kind worth shipping.

## You only carry the features you asked for

Soft deletes, state machines, auditing, tenancy, media attachments, roles, notifications — all of them are behaviour some models want and most do not. They ship as mixins, and a model opts in:

```ts
@table("users")
export class User extends Model.using(Authenticatable, Permissions, Roles) {}

@table("posts")
export class Post extends Model.using(SoftDeletes) {}

@table("invoices")
export class Invoice extends Model.using(SoftDeletes, Auditable) {}
```

Mixins fold left to right, the composed class keeps the whole Active Record surface, and every mixin's members are fully typed. A `Post` that never opted into `State` has no `transitionTo()` to call by mistake — the API surface _is_ the documentation of what this model does.

That is also why `delete()` means what it says. On a plain model it removes the row. `restore()`, `withTrashed()` and `forceDelete()` do not exist until `SoftDeletes` is composed in, so "did that delete or just hide?" is answered by reading the class declaration rather than by grepping for a config flag.

## The N+1 tells on itself

The classic ORM failure is not a wrong answer, it is a slow one that looks fine on the ten rows you tested with. Zerotal's detector is on **automatically outside production**: when one SQL shape repeats more than five times in a request, it logs a warning naming the relation you should have eager-loaded.

Then you can make it non-negotiable:

```ts
DB.preventNPlusOne({ threshold: 3, mode: "throw" });
```

`mode: "throw"` in CI turns a performance regression into a failing test, which is the only place it will ever be cheap to fix. And because some repetition is genuinely intended — a polling endpoint, an audit writer — you can silence a pattern permanently or just for the current request:

```ts
DB.allowNPlusOne("activity_logs");
DB.allowNPlusOne("taggings", { once: true });
```

Eager-loading itself composes with everything else, including aggregates, so the count you display next to each row is not another query per row:

```ts
const posts = await Post.query()
  .with("author")
  .withCount({ comments: (q) => q.where("approved", true) })
  .get();

posts[0].commentsCount; // number
```

## The builder shows its work

An abstraction you cannot see through is one you eventually fight. Every query compiles to SQL without running:

```ts
Post.query().where("status", "published").toSql();
// SELECT * FROM posts WHERE status = ?

Post.query().where("status", "published").toSqlWithBindings();
// { sql: "…", bindings: ["published"] }

Post.query().where("active", 1).dump().get(); // log it and keep chaining
```

`toRawSql()` inlines the values for a log line and is documented as logging-only — it bypasses parameterisation, so it is never fed back to the database.

And when the right answer is just SQL, the raw layer is right there: `DB.table()` speaks the same fluent API for unmodelled tables, `DB.transaction()` wraps whatever you like, and `lockForUpdate()` is available for the balance-decrement that actually needs it.

## Three pagination strategies, because there are three problems

Offset pagination is the right default and the wrong answer at scale, so it is not the only option:

| Strategy | Method                                         | For                                      |
| -------- | ---------------------------------------------- | ---------------------------------------- |
| Offset   | `paginate(20, page)`                           | Users jumping to arbitrary page numbers  |
| Cursor   | `cursorPaginate({ limit: 20 })`                | "Load more" feeds, stable across inserts |
| Keyset   | `keysetPaginate({ column, direction, limit })` | Infinite scroll on a large table         |

Keyset paginating on a non-unique column automatically adds an `id` tiebreaker, because a page boundary that lands in the middle of a run of equal values otherwise duplicates or skips rows — a bug that only appears at the boundary and only under real data.

## One model, three databases

All of it runs on Bun's native SQL client, and the same model code runs on SQLite, PostgreSQL, and MySQL. That is what makes `sqlite: { path: ":memory:" }` a real testing strategy rather than a toy: your suite builds the schema from your actual migrations, in memory, per run, and the model behaviour under test is the behaviour that ships.

```ts
export default DatabaseConfig({
  driver: env("DB_DRIVER", "sqlite"),
  url: env("DATABASE_URL", "./database/db.sqlite"),
  replicas: [], // reads round-robin; writes and transactions hit primary
});
```

Read replicas are one array. Locally you develop against a file; in production you point at Postgres and the models do not notice.

## The through-line

Look back at what those features have in common. Mass-assignment guarding, casts, scopes, route binding, state machines, soft deletes — none of them is a clever query. Every one of them is a rule that would otherwise be restated at each call site, moved onto the declaration instead, where there is exactly one copy of it and every consumer picks it up automatically.

That is the property worth optimising for, because it is the one that decays. Queries get faster; scattered rules get _inconsistent_, and inconsistent is the state where a bug is not a crash but a wrong answer nobody notices.

From here: [ORM](/docs/orm) covers models, columns and mass assignment, [Queries](/docs/orm/queries) has the full builder and the scopes above, [Relationships](/docs/orm/relationships) covers eager loading and pivots, [Lifecycle & Events](/docs/orm/lifecycle) has the state machine, observers and pruning, and [Database](/docs/database) covers transactions, replicas and the N+1 detector. Start fresh with `bun create zerotal` and the `api` template — it arrives with models, migrations and a test suite already wired.
