---
title: Models in Components
description: Put an ORM model on a Flow component — what crosses the wire, what the client may change, and what stays on the server.
---

# Models in Components

A Flow component can hold an ORM model directly:

```tsx
import { Component, expose, locked } from "zerotal/flow";
import { Post } from "../models/Post.ts";

export class ShowPost extends Component {
  @locked post!: Post;

  async onMount(): Promise<void> {
    this.post = await Post.findOrFail(this.postId);
  }

  async render() {
    return <article>{this.post.title}</article>;
  }
}
```

Nothing has to be declared. A model travels under its table name — the one `@table("…")`
sets, or the inflected default — which the app already declares and a minifier cannot mangle.
On the way back it is found through the registry that `app/models` discovery populates, which
is every model in the app.

## What crosses the wire

The snapshot carries the model's **id** and the result of its `toJSON()` — the same
serialisation your API responses use, honouring `visible`, `hidden` and `appends`.

```ts
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

A loaded relation is resolved the same way, through **its own** `toJSON()`. So `User.hidden`
protects `post.author.password`, and it has to: a parent's `hidden` list does not reach into a
relation. Declare `hidden` on the model that owns the column, not on the one that loads it.

## What the client may change

Only `fillable`, minus anything `hidden`. Everything else is server-owned, whatever the
browser sends:

| Column                               | Sent to the client | Client may write |
| ------------------------------------ | ------------------ | ---------------- |
| `name` — fillable, not hidden        | yes                | **yes**          |
| `role` — not fillable                | yes                | no               |
| `password` — fillable **and** hidden | no                 | no               |

A model that declares no `fillable` is read-only in the browser. That is the ORM's default:
it guards mass assignment until told otherwise, and a component does not widen it.

A field outside that set is **ignored**, not rejected — a crafted payload does not become a 500.

### Editing

Bind to a field of an `@expose`d model and it is two-way:

```tsx
export class EditProfile extends Component {
  @expose user!: User;

  @expose async save(): Promise<void> {
    this.validate({ "user.name": ["required", "min:2"] });
    await this.user.save();
    this.flash("Saved");
  }

  async render() {
    return (
      <form flow:submit="save">
        <input value={this.user.name} blur />
        <button>Save</button>
      </form>
    );
  }
}
```

`@locked` renders the same binding as a read-only display. Use it for anything the page shows
but does not edit.

**A password cannot be changed this way**, by design: it is `hidden`, so the browser never
receives it and cannot send it. Use a form object with its own `currentPassword` / `password`
/ `passwordConfirmation` fields — which is what you want anyway, since the stored hash has no
business in the page.

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

## Collections

An array of models is sent as ids and re-read with a single `whereIn` query:

```tsx
@locked posts: Post[] = [];
```

Collections are read-only on the client. Bind to a single model when you need to edit one.

## Next steps

- [Decorators](/docs/flow/decorators) — `@expose`, `@locked` and the rest of the property
  contract.
- [Forms & Uploads](/docs/flow/forms) — form objects, which are the right shape for
  multi-field editing and for anything a model cannot carry.
- [Mass assignment](/docs/orm#mass-assignment) — `fillable`, `guarded`, `hidden` and
  `visible`, which this page builds on.
