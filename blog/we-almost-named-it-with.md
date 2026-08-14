---
title: "We Almost Named It `with`"
description: "Zerotal 1.3.0 replaced BaseModelWith(...) with Model.using(...). The interesting part is not the refactor — it is why the obvious name was the wrong one, and what it costs a framework to spend a word."
date: 2026-08-10
category: Engineering
order: 4
---

# We Almost Named It `with`

Zerotal 1.3.0 changed how mixins compose. This used to be the idiom:

```ts
class User extends BaseModelWith(Authenticatable, Permissions, Roles) {}
class PostsPage extends ComponentWith(Pagination) {}
```

And this is the idiom now:

```ts
class User extends Model.using(Authenticatable, Permissions, Roles) {}
class PostsPage extends Component.using(Pagination) {}
```

A helper function became a static on the base class. Small change, one breaking release, a codemod in the repo that rewrites your call sites. The refactor is not the story. The story is that the first draft of this API was `Model.with(Roles)` — and the reason it shipped as `using` instead says something about how method names should be chosen.

## What was wrong with the helpers

`BaseModelWith` worked. It was also 537 lines long, and about 480 of those were twenty hand-written arity overloads — one signature for composing 1 mixin, one for 2, all the way to 20, each threading the accumulated type through to the next. Its Flow twin, `ComponentWith`, carried eight more. The actual implementation under both was three lines: fold the mixins left to right with `reduce`.

Worse than the line count: the helper hardcoded its base. `ComponentWith(Pagination)` always composed onto `Component`, so the moment you had an intermediate class — an `AdminPage` carrying shared guards that every admin screen extends — you were back to hand-nesting `Pagination(AdminPage)`, the exact wrapper-hell the helper existed to remove. It solved the problem one level deep.

A `static using()` with a polymorphic `this` type fixes both at once. The receiver _is_ the base, whatever it is:

```ts
abstract class AdminPage extends Component {
  @expose async guard() {
    /* shared authorization */
  }
}

class DashboardPage extends AdminPage.using(Pagination) {} // AdminPage stays in the chain
```

And because the composed class carries `using` itself, composition chains — `Model.using(A, B).using(C)` — which means arity stops mattering. The twenty overloads collapsed to eight per package. Around 420 lines of ceremony deleted, and the type inference is exactly as strict as before: `User.find()` still returns the fully composed type, `User.query().where("email", …)` still narrows on mixin-declared columns.

## The name

So far, so mechanical. The naming decision is where it got interesting.

`Model.with(Roles)` reads beautifully. It is also what the first draft used. Then we listed what `Model` already forwards as statics:

```text
all  count  create  find  findBy  findMany  findOrFail  first  firstOrCreate
firstOrFail  latest  oldest  orderBy  paginate  query  where  whereIn
updateOrCreate  upsert  …
```

That is the query builder, forwarded onto the model — and `with` is the one conspicuous hole in it. Anyone arriving from a PHP ORM already knows why that hole matters: `User::with('posts')` is one of the most-used statics there is. Zerotal's query builder has `.with()` for eager loading today; the static shorthand on the model is the obvious future addition, and the forwarder family is already built right up to its edge.

Spending `with` on mixin composition would have cost two things, permanently:

1. **The static everyone will ask for becomes unaddable.** Not harder — unaddable, without a second breaking rename.
2. **The model's static surface goes incoherent.** `User.where(…)` forwards to the query builder. `User.orderBy(…)` forwards to the query builder. `User.paginate(…)` forwards to the query builder. And `User.with(…)`… builds a class? No amount of documentation makes that read well.

A method name on a base class is not just a label — it is a budget line. Once spent, the word is gone from every future API discussion, and the good words are scarce.

`using` costs nothing. It collides with no shipped member (we checked, mechanically). It survives TypeScript's own `using` declarations — `using` became a contextual keyword in TS 5.2 for resource management, and _contextual_ is the operative word: as a member name it parses and infers normally, which we verified before committing rather than discovering later. And for the audience this framework courts, it maps onto a mental model they already own: PHP's `use SoftDeletes;` inside a model class is precisely the operation being performed.

```ts
class User extends Model.using(SoftDeletes, Roles) {}
```

"User extends Model, using SoftDeletes and Roles." It reads as prose. `BaseModelWith` never did.

## The other rename that fell out

Putting the base-class name at every declaration site exposed an asymmetry nobody had noticed: Flow's base is `Component`, not `BaseComponent` — but the ORM's was `BaseModel`, with `Model` exported as a compatibility alias that, we found, **not one file in the entire monorepo imported**. It existed; nothing used it.

So 1.3.0 inverts the alias. `Model` is canonical, `BaseModel` remains exported as the same class object, and nothing breaks — but `class User extends Model` is the documented form from here, symmetric with `class PostsPage extends Component`.

## Migrating

```bash
bun run scripts/codemod-mixin-composition.ts
```

The codemod rewrites call sites _and_ import specifiers — the part a find-and-replace gets wrong. How mixins are **authored** did not change at all: `<T extends Constructor>(Base: T) => class extends Base` is still the canonical form, and every shipped mixin kept its exact signature.

And the eager-load shorthand this whole argument protected? `User.with("posts")` is now free to exist. That is the point of not spending the word.
