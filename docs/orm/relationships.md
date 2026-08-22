---
title: Relationships
description: Define and query associations between models with relation decorators and eager loading.
---

# Relationships

Relation decorators describe how your models connect — one-to-one, one-to-many, many-to-many, through, and polymorphic — so you can traverse and eager-load associated records without writing JOINs by hand.

Zerotal's ORM supports all standard Active Record relationship types, plus polymorphic variants and eager loading with constraints. Relations are declared on the model class with decorators imported from `@zerotal/orm`; see [ORM](/docs/orm) for installing and configuring the package.

## One-to-one — @hasOne / @belongsTo

A `User` has one `Profile`. The foreign key (`user_id`) lives on the `profiles` table:

```typescript
// app/models/User.ts
import { Model, column, table, hasOne, belongsTo } from "@zerotal/orm";

@table("users")
export class User extends Model {
  @column("string") name!: string;

  @hasOne(() => Profile, { foreignKey: "user_id" })
  profile!: Profile;
}

@table("profiles")
export class Profile extends Model {
  @column("integer") userId!: number;
  @column("text") bio!: string;

  @belongsTo(() => User, { foreignKey: "userId" })
  user!: User;
}
```

```typescript
// in a controller
const user = await User.query().with("profile").findOrFail(1);
const profile = user.profile; // Profile — no extra query

// Access the inverse
const found = await Profile.findOrFail(1);
await found.load(["user"]);
console.log(found.user.name);
```

Both `@hasOne` and `@belongsTo` accept a `localKey` (defaults to `"id"`) to override the key the foreign key references.

## One-to-many — @hasMany / @belongsTo

A `User` has many `Post`s. The foreign key (`user_id`) lives on the `posts` table:

```typescript
// app/models/User.ts
@table("users")
export class User extends Model {
  @hasMany(() => Post, { foreignKey: "user_id" })
  posts!: Post[];
}

@table("posts")
export class Post extends Model {
  @column("integer") userId!: number;

  @belongsTo(() => User, { foreignKey: "userId" })
  author!: User;
}
```

```typescript
// in a controller
const user = await User.query().with("posts").findOrFail(1);
user.posts; // Post[]

// Constrained eager load
const users = await User.query()
  .with("posts", (q) => q.where("status", "published").orderBy("created_at", "desc"))
  .get();
```

## associate / dissociate

Set or clear a `belongsTo` foreign key without having to know the parent's ID directly:

```typescript
// in a controller
post.associate("author", user); // sets post.userId = user.id
await post.save();

post.dissociate("author"); // sets post.userId = null
await post.save();
```

> **Note** — `@belongsTo` also accepts `withDefault` (a boolean, an attributes object, or a callback) to return an unsaved default related model instead of `null` when the association is absent.

## Many-to-many — @manyToMany

A `Post` belongs to many `Tag`s through a `post_tags` pivot table:

```typescript
// app/models/Post.ts
import { Model, column, table, manyToMany, type ManyToMany } from "@zerotal/orm";

@table("posts")
export class Post extends Model {
  @manyToMany(() => Tag, {
    pivotTable: "post_tags",
    pivotForeignKey: "post_id", // FK pointing to Post
    pivotRelatedKey: "tag_id", // FK pointing to Tag
  })
  tags!: ManyToMany<Tag>;
}

@table("tags")
export class Tag extends Model {
  @column("string") name!: string;
}
```

### Pivot operations

```typescript
// in a controller
// Attach one or multiple tags
await post.tags.attach(tagId);
await post.tags.attach([1, 2, 3]);

// Detach specific tags
await post.tags.detach(tagId);

// Detach all tags
await post.tags.detach();

// Sync — replaces all pivot rows with the given set
await post.tags.sync([1, 2, 3]);

// Toggle — attach if not present, detach if already present
await post.tags.toggle(tagId);
```

### Extra pivot columns

If the pivot table has additional columns, declare them with `withPivot`:

```typescript
// app/models/User.ts
@manyToMany(() => Role, {
  pivotTable: "user_roles",
  pivotForeignKey: "user_id",
  pivotRelatedKey: "role_id",
  withPivot: ["assigned_at", "assigned_by"],
})
roles!: ManyToMany<Role>;
```

```typescript
// in a controller — attach with extra pivot data
await user.roles.attach(roleId, { assigned_by: adminId, assigned_at: new Date() });
```

> **Tip** — Pass `withTimestamps: true` to keep `created_at` / `updated_at` maintained on the pivot table during `attach` and `sync`.

## Through relationships — @hasManyThrough / @hasOneThrough

Access distant models through an intermediate model. A `Country` has many `Post`s through `User`s:

```typescript
// app/models/Country.ts
import { hasManyThrough, hasOneThrough } from "@zerotal/orm";

@table("countries")
export class Country extends Model {
  // Country → User (firstKey: FK on users that points to countries)
  // User    → Post (secondKey: FK on posts that points to users)
  @hasManyThrough(() => Post, () => User, {
    firstKey: "country_id", // users.country_id
    secondKey: "user_id", // posts.user_id
  })
  posts!: Post[];

  @hasOneThrough(() => Post, () => User, {
    firstKey: "country_id",
    secondKey: "user_id",
  })
  latestPost!: Post;
}
```

```typescript
// in a controller
const country = await Country.query().with("posts").findOrFail(1);
country.posts; // Post[] — no manual JOIN required
```

## Polymorphic relationships

Polymorphic relationships let a single model belong to multiple other models using a type+id pair.

### @morphMany / @morphOne / @morphTo

A `Comment` can belong to either a `Post` or a `Video`:

```typescript
// app/models/Post.ts
import {
  morphMany,
  morphOne,
  morphTo,
  type MorphMany,
  type MorphOne,
  type MorphTo,
} from "@zerotal/orm";

// Parent side — Post has many Comments (polymorphic)
@table("posts")
export class Post extends Model {
  @morphMany(() => Comment, { morphName: "commentable" })
  declare comments: MorphMany<Comment>;

  @morphOne(() => Image, { morphName: "imageable" })
  declare image: MorphOne<Image>;
}

// Owning side — Comment stores commentable_type + commentable_id
@table("comments")
export class Comment extends Model {
  @column("string") declare commentableType: string;
  @column("integer") declare commentableId: number;

  @morphTo({
    morphMap: {
      Post: () => Post,
      Video: () => Video,
    },
  })
  declare commentable: MorphTo<Post | Video>;
}
```

The `morphName` (`"commentable"`) determines the `commentable_type` and `commentable_id` columns. For `@morphTo`, the `morphMap` keys are stored in the `*_type` column; by default the column names derive from the property name (`commentable` → `commentable_type` / `commentable_id`), and you can override them with `morphTypeColumn` / `morphForeignKey`.

> **Warning** — Renaming a `morphMap` key without migrating existing `*_type` rows will break every stored polymorphic association. Keep the keys stable — changing one requires a data migration.

```typescript
// in a controller
// Eager load polymorphic relations
const posts = await Post.query().with("comments").get();
posts[0].comments; // Comment[]

const comment = await Comment.query().with("commentable").findOrFail(1);
comment.commentable; // Post | Video
```

### @morphToMany / @morphedByMany — polymorphic many-to-many

Share a tagging system across multiple model types through a single `taggables` pivot:

```typescript
// app/models/Post.ts
import { morphToMany, morphedByMany, type ManyToMany } from "@zerotal/orm";

// Post can be tagged
@table("posts")
export class Post extends Model {
  @morphToMany(() => Tag, { morphName: "taggable", relatedPivotKey: "tag_id" })
  tags!: ManyToMany<Tag>;
}

// Video can also be tagged using the same tags table
@table("videos")
export class Video extends Model {
  @morphToMany(() => Tag, { morphName: "taggable", relatedPivotKey: "tag_id" })
  tags!: ManyToMany<Tag>;
}

// Inverse — Tag can retrieve all Posts tagged with it
@table("tags")
export class Tag extends Model {
  @morphedByMany(() => Post, { morphName: "taggable", parentPivotKey: "tag_id" })
  posts!: ManyToMany<Post>;
}
```

The pivot table name defaults to `{morphName}s` (here `taggables`). Its schema:

```sql
-- migration: create the taggables pivot
CREATE TABLE taggables (
  tag_id         INTEGER NOT NULL,
  taggable_id    INTEGER NOT NULL,
  taggable_type  TEXT    NOT NULL
);
```

## Eager loading

Always prefer eager loading over lazy loading in loops — it prevents N+1 queries.

> **Tip** — Reach for `.with()` whenever you access a relation across a collection; lazy-loading inside a loop fires one query per row.

```typescript
// in a controller
// Single relation
const posts = await Post.query().with("author").get();
posts[0].author; // User — no extra query

// Multiple relations
const withBoth = await Post.query().with("author").with("comments").get();

// Nested relations (dot notation)
const nested = await Post.query().with("author.profile").get();
nested[0].author.profile; // Profile

// With constraints — only load approved comments
const filtered = await Post.query()
  .with("comments", (q) => q.where("approved", true).orderBy("created_at"))
  .get();

// Load count alongside models (no separate query)
const counted = await Post.query().withCount("comments").get<Post & { commentsCount: number }>();

counted[0].commentsCount; // number
```

> **Note** — `withCount("comments")` exposes the count as the camel-cased `commentsCount` property on each result (the underlying `comments_count` SQL alias is converted for you).

### Lazy eager loading on existing instances

When you already have a model instance and realise you need a relation:

```typescript
// in a controller
const post = await Post.findOrFail(1);

// Load a relation that wasn't included in the original query
await post.load(["author", "comments"]);

// Load only if not already loaded (avoids redundant queries)
await post.loadMissing(["author"]);
```

## Relation existence filtering

Filter a parent model based on whether its relation exists, without loading the related rows:

```typescript
// in a controller
// Posts that have at least one comment
Post.query().has("comments").get();

// Posts with 3 or more comments
Post.query().has("comments", ">=", 3).get();

// Posts with no comments at all
Post.query().doesntHave("comments").get();

// Posts with at least one approved comment
Post.query()
  .whereHas("comments", (q) => q.where("approved", true))
  .get();

// Posts without any approved comment
Post.query()
  .whereDoesntHave("comments", (q) => q.where("approved", true))
  .get();

// Filter by relation AND eager-load with the same constraint in one pass
Post.query()
  .withWhereHas("comments", (q) => q.where("approved", true))
  .get();
```

> **Warning** — `has()` / `whereHas()` are not supported for `morphTo` relations — the related table isn't known until each row's `*_type` is read. Use eager loading via `with()` for those instead.

## Choosing the right relationship type

Reach for the decorator that matches the shape of your data:

| Scenario                             | Decorator                                             |
| ------------------------------------ | ----------------------------------------------------- |
| User has one Profile                 | `@hasOne` on User, `@belongsTo` on Profile            |
| User has many Posts                  | `@hasMany` on User, `@belongsTo` on Post              |
| Post belongs to many Tags            | `@manyToMany` on both                                 |
| Country → User → Post                | `@hasManyThrough` on Country                          |
| Comment belongs to Post **or** Video | `@morphTo` on Comment, `@morphMany` on each parent    |
| Tag applies to Post **and** Video    | `@morphToMany` on each model, `@morphedByMany` on Tag |

The rule of thumb: put `@belongsTo` on whichever side stores the foreign-key column, and the matching `@hasOne` / `@hasMany` on the other. Use a polymorphic variant only when one side must point at more than one parent type.

## References

Relation decorators — imported from `@zerotal/orm`, applied to a model property.

| Decorator         | Signature                                                                                                                    | Description                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@hasOne`         | `hasOne(related, { foreignKey, localKey? })`                                                                                 | One related record; FK lives on the related table.     |
| `@hasMany`        | `hasMany(related, { foreignKey, localKey? })`                                                                                | Many related records; FK lives on the related table.   |
| `@belongsTo`      | `belongsTo(related, { foreignKey, localKey?, withDefault? })`                                                                | Inverse of has-one/has-many; FK lives on this model.   |
| `@manyToMany`     | `manyToMany(related, { pivotTable, pivotForeignKey, pivotRelatedKey, localKey?, relatedKey?, withPivot?, withTimestamps? })` | Many-to-many through a pivot table.                    |
| `@hasManyThrough` | `hasManyThrough(related, through, { firstKey, secondKey, localKey?, throughLocalKey? })`                                     | Many records across an intermediate model.             |
| `@hasOneThrough`  | `hasOneThrough(related, through, { firstKey, secondKey, localKey?, throughLocalKey? })`                                      | Single record across an intermediate model.            |
| `@morphMany`      | `morphMany(related, { morphName, localKey? })`                                                                               | Polymorphic one-to-many (parent side).                 |
| `@morphOne`       | `morphOne(related, { morphName, localKey? })`                                                                                | Polymorphic one-to-one (parent side).                  |
| `@morphTo`        | `morphTo({ morphMap, morphTypeColumn?, morphForeignKey? })`                                                                  | Owning side; resolves the parent via the `*_type` map. |
| `@morphToMany`    | `morphToMany(related, { morphName, relatedPivotKey, pivotTable?, withPivot?, withTimestamps? })`                             | Polymorphic many-to-many (owning side).                |
| `@morphedByMany`  | `morphedByMany(related, { morphName, parentPivotKey, pivotTable?, withPivot?, withTimestamps? })`                            | Polymorphic many-to-many (inverse side).               |

Query and instance methods used with relations.

| Method            | Signature                                                         | Description                                                            |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `with`            | `with(relation, constraint?)` / `with(relations[])` / `with(map)` | Eager-load a relation (dot notation for nesting; optional constraint). |
| `withCount`       | `withCount(relation \| map)`                                      | Add a `<relation>Count` subquery column to each result.                |
| `has`             | `has(relation, operator?, count?)`                                | Keep parents that have the relation (optionally count-filtered).       |
| `doesntHave`      | `doesntHave(relation, callback?)`                                 | Keep parents that lack the relation.                                   |
| `whereHas`        | `whereHas(relation, callback?)`                                   | Keep parents whose relation matches a constraint.                      |
| `whereDoesntHave` | `whereDoesntHave(relation, callback?)`                            | Keep parents whose relation does not match a constraint.               |
| `withWhereHas`    | `withWhereHas(relation, callback?)`                               | Filter by the relation and eager-load it with the same constraint.     |
| `associate`       | `associate(relation, model): this`                                | Set a `belongsTo` foreign key from a related model instance.           |
| `dissociate`      | `dissociate(relation): this`                                      | Clear a `belongsTo` foreign key (sets it to `null`).                   |
| `load`            | `load(relations[]): Promise<this>`                                | Lazy-load relations onto an existing instance.                         |
| `loadMissing`     | `loadMissing(relations[]): Promise<this>`                         | Load relations only if not already loaded.                             |

Pivot collection methods on a `ManyToMany<T>` relation.

| Method   | Signature                                       | Description                                           |
| -------- | ----------------------------------------------- | ----------------------------------------------------- |
| `attach` | `attach(id \| id[], pivotData?): Promise<void>` | Insert pivot rows, optionally with extra column data. |
| `detach` | `detach(id?\| id[]): Promise<void>`             | Delete pivot rows; omit the id to detach all.         |
| `sync`   | `sync(ids[]): Promise<void>`                    | Replace all pivot rows with the given set.            |
| `toggle` | `toggle(id \| id[]): Promise<void>`             | Attach missing ids and detach present ones.           |

## Next steps

- [ORM queries](/docs/orm/queries) — eager loading, `whereHas`, and aggregates in depth.
- [ORM serialization](/docs/orm/serialization) — control how related models appear in JSON.
- [ORM lifecycle](/docs/orm/lifecycle) — react to changes on related records.
- [Migrations](/docs/migrations) — create the pivot and foreign-key columns these relations need.
