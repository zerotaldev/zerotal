---
title: ORM Serialization
description: Control exactly which model fields reach your JSON API responses.
---

# Serialization

Models serialize to plain JavaScript objects for API responses and `JSON.stringify()`. You control what gets exposed with `hidden`, `visible`, and `appends`, and can customize the output further with per-instance overrides.

## Basic usage

Every `Model` has a `toJSON()` method. It returns a plain object you can pass straight to the `json()` response helper — and `JSON.stringify()` calls it for you automatically:

```typescript
// in a controller
import { json } from "zerotal";
import { User } from "../models/User.ts";

const user = await User.findOrFail(1);
json(user.toJSON());
// { id: 1, name: "Alice", email: "alice@example.com", createdAt: "…" }
```

## Class-level configuration

Three static properties on the model class shape `toJSON()` for every instance: `hidden`, `visible`, and `appends`.

### static hidden — exclude fields

Fields in `hidden` are stripped from `toJSON()` output. Use this to prevent sensitive data from leaking into API responses:

```typescript
// app/models/User.ts
import { Model, table, column } from "@zerotal/orm";

@table("users")
export class User extends Model {
  static hidden = ["password", "rememberToken", "twoFactorSecret"];

  @column("string") name!: string;
  @column("string") email!: string;
  @column("string") password!: string;
  @column("string") rememberToken?: string;
  @column("string") twoFactorSecret?: string;
}

const user = await User.findOrFail(1);
user.toJSON();
// { id: 1, name: "Alice", email: "alice@example.com", ... }
// password, rememberToken, twoFactorSecret are absent
```

> **Danger** — Password hashes and tokens leak into every API response unless the column is listed in `hidden` (or excluded via `visible`).

### static visible — allowlist fields

`visible` takes precedence over `hidden`. When set (non-empty), `toJSON()` includes **only** those keys:

```typescript
// app/models/User.ts
@table("users")
export class User extends Model {
  // Only these fields appear in JSON — everything else is excluded:
  static visible = ["id", "name", "email", "avatarUrl"];
}
```

Use `visible` for models that have many internal columns and you want to be explicit about what's safe to expose, rather than listing everything you want to hide.

### static appends — computed accessors

Include the result of a getter method in `toJSON()`. The getter runs at serialization time:

```typescript
// app/models/User.ts
@table("users")
export class User extends Model {
  @column("string") firstName!: string;
  @column("string") lastName!: string;

  static appends = ["fullName", "avatarUrl"];

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  get avatarUrl(): string {
    return `https://cdn.example.com/avatars/${this.id}.jpg`;
  }
}

user.toJSON();
// { id: 1, firstName: "Alice", lastName: "Smith", fullName: "Alice Smith", avatarUrl: "https://…" }
```

## Per-instance overrides

Adjust what a specific instance exposes without modifying the class definition. Each method mutates the instance and returns `this`, so they chain and can be passed straight to `json()`:

```typescript
// in a controller
// Temporarily hide additional fields for this response:
json(user.makeHidden("email", "phone").toJSON());

// Reveal a field that the class hides (e.g. in an admin context):
json(user.makeVisible("twoFactorSecret").toJSON());

// Append a computed accessor for this instance only:
json(user.append("temporaryToken").toJSON());

// Chain multiple overrides:
json(user.makeHidden("password").makeVisible("phoneVerifiedAt").append("isVerified").toJSON());
```

> **Note** — `makeVisible()` wins over `hidden`: revealing a key removes it from the effective hidden set, even if the class lists it in `static hidden`.

## toJSON output format

`toJSON()` returns a plain `Record<string, unknown>` with:

- **camelCase keys** — a `created_at` column is exposed as the `createdAt` property and serialized as such.
- **Casts applied** — `datetime` columns return ISO strings, `boolean` returns `true`/`false`, etc. See [ORM casts](/docs/orm/casts).
- **Hidden fields removed** — per `static hidden` and any `makeHidden()` overrides.
- **Appended accessors included** — per `static appends` and any `append()` overrides.
- **Loaded relations included** — nested models serialize via their own `toJSON()`.

```typescript
// in a controller
const post = await Post.query().with("author").findOrFail(1);

post.toJSON();
// {
//   id: 1,
//   title: "Hello world",
//   status: "published",
//   publishedAt: "2024-01-15T10:30:00.000Z",
//   createdAt: "2024-01-10T08:00:00.000Z",
//   author: { id: 3, name: "Alice", email: "alice@example.com" }
// }
```

`toJSON()` is called automatically by `JSON.stringify()` and by the `json()` and `view()` response helpers.

## Serializing collections

When you have an array of models, call `toJSON()` on each item or rely on `JSON.stringify()`:

```typescript
// in a controller
const posts = await Post.query().where("status", "published").get();

// Explicit — map to plain objects first:
json(posts.map((p) => p.toJSON()));

// Implicit — JSON.stringify calls toJSON() on each model automatically:
json(posts);
```

## Serialization and relationships

Hidden/visible lists apply per-model and do **not** propagate to nested relations. Each nested model serializes via its own class configuration:

```typescript
// app/models/User.ts and app/models/Post.ts
@table("users")
export class User extends Model {
  static hidden = ["password"]; // only applies to User
}

@table("posts")
export class Post extends Model {
  // No hidden config — exposes all columns
}

const post = await Post.query().with("author").findOrFail(1);
post.toJSON();
// { ..., author: { id: 1, name: "Alice", email: "alice@example.com" } }
// User.hidden = ["password"] applies to the nested author — password is absent
```

## API Resource pattern

For fine-grained, per-endpoint serialization, use API Resources instead of class-level `hidden`/`visible`. A `Resource` wraps a model in `this.resource` and lets you shape the output per route without touching the model class. By default the output is wrapped in a `{ data: ... }` envelope:

```typescript
// app/resources/PostResource.ts
import { Resource } from "zerotal/http";
import type { Post } from "../models/Post.ts";

export class PostResource extends Resource<Post> {
  toArray(): Record<string, unknown> {
    return {
      id: this.resource.id,
      title: this.resource.title,
      excerpt: this.resource.body.slice(0, 160),
      publishedAt: this.resource.publishedAt?.toISOString(),
    };
  }
}
```

Build a single resource with `new PostResource(post)`, then `toJson()` for a plain object or `toResponse()` for a `Response`. Serialize a list with the static `collection()` helper, which takes the resource class first:

```typescript
// in a controller
import { json } from "zerotal";
import { PostResource } from "../resources/PostResource.ts";

// One model → { data: { id, title, … } }
json(new PostResource(post).toJson());

// Many models → { data: [ … ] }
json(PostResource.collection(PostResource, posts));
```

> **Tip** — Call `Resource.withoutWrapping()` once at boot if you prefer flat responses without the `{ data: ... }` envelope. For paginated results, `ResourceCollection.of(PostResource, paginated)` adds `meta` and `links`.

## Which should I use?

| Approach                           | Reach for it when                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `static hidden` / `static visible` | Globally sensitive fields (passwords, tokens) that should never be exposed.   |
| `makeHidden()` / `makeVisible()`   | A one-off tweak for a single response (e.g. an admin endpoint).               |
| `static appends` / `append()`      | Adding computed values (full name, URLs) that aren't real columns.            |
| `Resource`                         | Different shapes per route, or output that diverges from the model's columns. |

Use model-level `hidden`/`visible` for globally sensitive fields. Use Resources for per-route shaping.

## References

`toJSON()` and the override methods live on every [`Model`](/docs/orm); the `Resource` helpers are exported from `zerotal`.

| Member                  | Signature                                                          | Description                                                      |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `static hidden`         | `string[]`                                                         | Column/accessor keys excluded from `toJSON()`.                   |
| `static visible`        | `string[]`                                                         | Allow-list; when non-empty, only these keys serialize.           |
| `static appends`        | `string[]`                                                         | Getter names whose return values are added to `toJSON()`.        |
| `toJSON()`              | `toJSON(): Record<string, unknown>`                                | Serialize the model to a plain object.                           |
| `makeHidden()`          | `makeHidden(...keys: string[]): this`                              | Hide extra keys for this instance only.                          |
| `makeVisible()`         | `makeVisible(...keys: string[]): this`                             | Reveal hidden keys for this instance only.                       |
| `append()`              | `append(...keys: string[]): this`                                  | Add computed accessor(s) for this instance only.                 |
| `Resource#toArray()`    | `toArray(): Record<string, unknown>`                               | Define the serialized representation (override this).            |
| `Resource#toJson()`     | `toJson(): Record<string, unknown>`                                | Plain object, wrapped in `{ data }` unless wrapping is disabled. |
| `Resource.collection()` | `collection(ResourceClass, items, meta?): Record<string, unknown>` | Serialize an array of models with a resource class.              |

## Next steps

- [ORM](/docs/orm) — model definition, casts, and configuration.
- [ORM relationships](/docs/orm/relationships) — load the related models you serialize here.
- [ORM casts](/docs/orm/casts) — control how column values appear in serialized output.
- [Responses](/docs/responses) — the `json()` helper that calls `toJSON()`.
