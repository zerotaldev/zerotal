---
title: Models in Components
description: Put an ORM model on a Flow component — what crosses the wire, what the client may change, and what stays on the server.
---

# Models in Components

A Flow component can hold an ORM model directly. On a route that names one, it arrives loaded:

```tsx
import { Component, locked } from "@zerotal/flow";
import { Post } from "@app/models/Post.ts";

export class ShowPost extends Component {
  @locked post!: Post; // /posts/:post — the record, already found

  override async render() {
    return <article>{this.post.title}</article>;
  }
}
```

There is no `onMount()`, because there is nothing to fetch. The router resolved `:post` before
the component was built, and a field of that type receives the result — so the query, the
`postId` field it would have needed, and the 404 handling all belong to the route rather than
to this page. [Path parameters](/docs/flow/routing#path-parameters) covers what a segment
binds to and how a model resolves by something other than its primary key.

The other way a model arrives is from a parent that already has it, as a prop:

```tsx fragment
<PostCard post={this.post} />
```

Either way the model is a model on the other side — not a plain object shaped like one — and
everything below applies the same to both.

Nothing has to be declared. A model travels under its table name — the one `@table("…")`
sets, or the inflected default — which the app already declares and a minifier cannot mangle.
On the way back it is found through the registry that `app/models` discovery populates, which
is every model in the app.

> **Fetching a model in `onMount()` is the older way of doing this**, from before a component
> could hold one. It still runs, and it is still right for a record no route names and no
> parent has — a list, a lookup keyed off something the URL does not carry. It is the wrong
> shape for the record the page is _about_: that one the route already found.

The decorator is the whole decision: **`@locked` for a model the page displays, `@expose` for
one it edits.** Both put the model on the client; only `@expose` accepts anything back.

## What crosses the wire

The snapshot carries the model's **id** and the result of its `toJSON()` — the same
serialisation your API responses use, honouring `visible`, `hidden` and `appends`.

```ts fragment
@table("users")
export class User extends BaseModel {
  static fillable = ["name", "email", "password"];
  static hidden = ["password"];
}
```

`password` is never sent. Nothing else has to be configured for that: the model already
declares its serialisation surface, and Flow uses it.

> **`hidden` is a security control here.** On an API response an omitted column is a matter of
> shape. On a component it is the only thing keeping a value out of the page. A snapshot is
> signed, not encrypted — the browser can read every byte of it. Declare `hidden` (or
> `visible`) on any model a component holds.

A loaded relation is resolved the same way, through its own `toJSON()` — every model hides
its own columns, however deep it sits.

The id travels separately from the values, in the part of the snapshot a client write cannot
reach. **Which record a component points at is not something the browser can change** — only
the values on it, and only the ones below.

## What the client may change

Only `fillable`. Everything else is server-owned, whatever the browser sends:

| Column                               | Sent to the client | Client may write |
| ------------------------------------ | ------------------ | ---------------- |
| `id` — the identity                  | yes                | no               |
| `name` — fillable, not hidden        | yes                | **yes**          |
| `role` — not fillable                | yes                | no               |
| `password` — fillable **and** hidden | no                 | **yes**          |

A model that declares no `fillable` is read-only in the browser. That is the ORM's default:
it guards mass assignment until told otherwise, and a component does not widen it.

A field outside that set is **ignored**, not rejected — a crafted payload does not become a
server error. To refuse a value loudly instead, or to vet one before it lands, throw from
[`onUpdating()`](/docs/flow/lifecycle#intercepting-client-writes).

### Editing

Bind to a field of an `@expose`d model and it is two-way:

```tsx fragment
export class EditProfile extends Component {
  @expose user!: User;

  @expose async save(): Promise<void> {
    if (this.user.name.trim().length < 2) {
      this.addError("name", "Your name needs at least two characters.");
      return;
    }
    await this.user.save();
    this.flash("Saved");
  }

  override async render() {
    return (
      <form onSubmit={this.save}>
        <input value={this.user.name} blur />
        <span error={this.errors.name} />
        <button>Save</button>
      </form>
    );
  }
}
```

`save()` writes only the columns that actually differ. The row was re-read a moment earlier
(see [Freshness](#freshness)), so the model's idea of "unchanged" is the row as it is now, not
the one the page was built from.

A `@locked` model is display-only, and its fields are not bound: render them as text —
`<p>{this.post.title}</p>` — rather than as an input. An input pointed at one accepts typing
and sends nothing.

### Validating a model's fields

`this.validate()` rules are keyed by the component's **own** exposed properties, and a model's
columns are not among them: `"user.name"` looks for a property with that name, finds nothing,
and fails whatever the field actually holds. Two ways round it:

- **Check in the action**, then `this.addError(field, message)` — as above. Right for a field
  or two.
- **Use a [form object](/docs/flow/forms)** for anything larger. It is the shape built for
  validated multi-field editing, and it can carry values no column has: a confirmation field,
  a current-password check, an upload.

### Hidden fields are writable

`hidden` governs what is _shown_, not what may be written. A password is the case that makes
the difference: fillable because a user sets it, hidden because the stored hash must never
reach the page.

```tsx fragment
<input type="password" value={this.user.password} blur />
```

The stored hash is never sent, so the field starts empty. What the user types is held until
they save — it travels back to the browser that produced it, and nowhere else. A value the
_server_ set is never echoed, and a half-typed one is never written to the
[durable store](/docs/flow/lifecycle).

What reaches the database is a hash rather than what was typed, as long as the column is
listed in the model's `hashable` — see [Password hashing](/docs/orm#password-hashing).

## Relations

A relation that is loaded when the page renders travels with the model, through its own
`toJSON()`. It does not survive the round-trip:

```tsx fragment
override async onMount(): Promise<void> {
  await this.post.loadMissing(["author"]); // this.post came from the route
}
```

That renders. **The next interaction has no `author`** — the re-read is a find by id, which
fetches the row and not the relations that happened to be loaded around it. Reading it then
throws the ORM's guard: `Relation "author" was accessed on Post without eager loading`.

Load what an action needs, where it needs it:

```ts fragment
@expose async approve(): Promise<void> {
  await this.post.loadMissing(["author"]);
  this.post.approved = true;
  await this.post.save();
  this.flash(`Approved — ${this.post.author.name} has been credited.`);
}
```

When the page _displays_ the relation, load it once per round-trip in
[`onHydrate()`](/docs/flow/lifecycle#re-deriving-state-after-hydration) instead. Rendering is
the case worth watching: a template reading `this.post.author.name` works on the first paint
and throws on every interaction after it.

```ts fragment
override async onHydrate(): Promise<void> {
  await this.post.loadMissing(["author"]);
}
```

## Freshness

The model is **re-read from the database on every round-trip**, by id. What the client holds
is a rendering of a row, not the row.

Two consequences worth knowing:

- **Server-owned columns are always current.** If someone else changes `role`, the next
  interaction shows the new value.
- **Unsaved changes survive.** A change an action made without calling `save()` is restored
  from the snapshot, so a half-filled field does not revert the moment something else happens.
  Only the writable fields are restored; everything else comes from the fresh row.

If two people edit the same record, the one who saves last wins. Flow does not add optimistic
locking — add a version column and check it in `save()` if a record needs it.

### A row that disappears

The re-read is a `findOrFail`, and it applies the same scopes your own queries do. A record
deleted — or soft-deleted — while a page holds it makes the next interaction fail: nothing is
patched, and the browser console carries the error. So follow a delete with a navigation
rather than leaving the prop pointing at a row that is gone:

```ts fragment
@expose async destroy(): Promise<void> {
  await this.post.delete();
  this.redirect("/posts");
}
```

## Collections

An array of models is sent as ids and re-read with a single `whereIn` query:

```tsx fragment
@locked posts: Post[] = [];
```

Collections are read-only on the client. Bind to a single model when you need to edit one.

Two things follow from ids and one `whereIn`:

- **Order does not travel.** The re-read carries no `order by`, so the order you loaded them
  in is not guaranteed to come back. Sort where you render, or re-run the real query in
  `onHydrate()`.
- **Rows that vanish drop out quietly.** A `whereIn` returns what it finds, so a deleted
  record leaves the array one shorter — unlike a single model, whose disappearance fails the
  interaction.

## What a round-trip costs

Each model prop is one query per interaction, and each collection one more. That is the price
of never showing a stale row, and for most pages it is the right trade. When it is not:

- **[`@transient`](/docs/flow/decorators#the-transient-decorator)** keeps a value off the
  client and out of the snapshot entirely — nothing is sent, and nothing is re-read.
- **Hold an id and query it yourself** in `onHydrate()` when the query needs shaping the
  re-read cannot do: eager loads, ordering, a scope. `@locked postId: number` plus one query
  is the whole pattern.
- **A [form object](/docs/flow/forms)** when the page is editing many fields — it edits a
  plain object, and touches the database once, in your action.

## Troubleshooting

| What you see                            | What it means                                                        |
| --------------------------------------- | -------------------------------------------------------------------- |
| `No model maps to "posts"`              | The class is not in `app/models`, or its `@table` no longer matches. |
| `Post has no table name`                | Give the class `@table("…")`.                                        |
| `Relation "author" was accessed`        | It was loaded in `onMount()`, and this is a later round-trip.        |
| An edited field never saves             | It is not in `fillable`, so the write was ignored.                   |
| A field snaps back after an interaction | The same cause, seen from the page: the fresh row won the re-render. |
| A password field empties itself         | The column is `hidden` but not `fillable`, so nothing was applied.   |

## Next steps

- [Decorators](/docs/flow/decorators) — `@expose`, `@locked` and the rest of the property
  contract.
- [Lifecycle](/docs/flow/lifecycle) — `onHydrate()`, `onUpdating()` and where per-round-trip
  work belongs.
- [Forms & Uploads](/docs/flow/forms) — form objects, which are the right shape for
  multi-field editing and for anything a model cannot carry.
- [Mass assignment](/docs/orm#mass-assignment) — `fillable`, `guarded`, `hidden` and
  `visible`, which this page builds on.
- [Relationships](/docs/orm/relationships) — eager loading, `load()` and `loadMissing()`.
