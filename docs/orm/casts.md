---
title: Casts & Mutators
description: Translate between raw database values and rich, typed TypeScript values on every read and write.
---

# Casts & Mutators

Casts translate between the raw value stored in the database and the typed
TypeScript value you work with on your model. Declare them inline on `@column()`
or in a class-level `static casts` map; custom casts give you full control over
both the read (get) and write (set) transforms.

## Basic usage

The shorthand string passed to `@column("…")` is a cast alias. Each one resolves
to a built-in get/set pair:

```typescript
// app/models/Post.ts
import { Model, column, table } from "@zerotal/orm";
import { Carbon } from "zerotal/carbon";

@table("posts")
export class Post extends Model {
  @column("string") title!: string;
  @column("integer") views!: number;
  @column("float") score!: number;
  @column("boolean") published!: boolean;
  @column("datetime") publishedAt!: Carbon;
  @column("date") birthday?: Date;
  @column("json") meta!: Record<string, unknown>;
  @column("array") tags!: string[];
  @column("text") bio?: string;
}
```

## Built-in cast shorthands

| Shorthand             | TypeScript type | Read (DB → model)              | Write (model → DB) |
| --------------------- | --------------- | ------------------------------ | ------------------ |
| `'string'` / `'text'` | `string`        | as-is                          | as-is              |
| `'integer'`           | `number`        | `parseInt()`                   | `parseInt()`       |
| `'float'`             | `number`        | `parseFloat()`                 | `parseFloat()`     |
| `'boolean'`           | `boolean`       | coerces `0`/`1`/`"1"`/`"true"` | writes `1` or `0`  |
| `'datetime'`          | `Carbon`        | constructs a `Carbon` instance | ISO 8601 string    |
| `'date'`              | `Date`          | constructs a native `Date`     | ISO 8601 string    |
| `'json'`              | `unknown`       | `JSON.parse()`                 | `JSON.stringify()` |
| `'array'`             | `unknown[]`     | `JSON.parse()`                 | `JSON.stringify()` |

> **Note** — `@column("date")` reads back a native `Date`, while
> `@column("datetime")` reads back a [Carbon](/docs/carbon) instance. Type the
> property accordingly.

### Scalars in a json column

`json` and `array` encode on write and parse on read, in both directions, so a value
round-trips as the type you gave it — including a bare scalar:

```typescript
setting.value = "62812345678"; // stored as "62812345678", read back as a string
setting.value = "051001"; // a branch code keeps its leading zero
setting.value = { plan: "pro" }; // objects and arrays as you would expect
```

This is worth stating because the obvious alternative is wrong. Skipping the encode for
values that are already strings looks like it avoids double-encoding, but it makes the
column hold bare characters — and `JSON.parse("62812345678")` is a **number**. The value's
type would change between write and read, silently, for some values and not others.

If you are reading rows written by an older version that stored bare scalars, a value that
was a numeric string may come back as a number; coerce on read where it matters.

## Advanced cast options

### decimal:N — fixed-precision number

Reads and writes the value as a string with exactly `N` decimal places. Useful
for currency, where you want to avoid floating-point drift:

```typescript
// app/models/Product.ts
@column({ type: "number", cast: "decimal:2" }) price!: string;
// DB stores "9.99" — the model reads it back as the string "9.99".
```

> **Note** — Because both the read and write transforms call `.toFixed(N)`, a
> `decimal:N` column surfaces as a **string**, not a number. Type the property
> as `string`.

### immutable_datetime — datetime alias

Behaves like `'datetime'` on read (constructs a [Carbon](/docs/carbon)) and
serializes to an ISO 8601 string on write:

```typescript
// app/models/Booking.ts
@column({ type: "datetime", cast: "immutable_datetime" }) lockedAt?: Carbon;

const tomorrow = booking.lockedAt?.add(1, "day"); // returns a new Carbon
```

> **Note** — Every `Carbon` is already immutable: each modifier such as `add()`
> returns a _new_ instance and never mutates the original. So
> `immutable_datetime` and `datetime` produce equivalent values — always assign
> the result of a modifier rather than relying on in-place mutation.

### enum — TypeScript enums

Stores and retrieves the raw enum value (the underlying string or number);
TypeScript narrows the property type. The cast itself is a pass-through, so pair
it with `enumValues` to document the enum:

```typescript
// app/models/Post.ts
enum Status {
  Draft     = "draft",
  Published = "published",
  Archived  = "archived",
}

@column({ type: "string", cast: "enum", enumValues: Status }) status!: Status;

// TypeScript now knows post.status is Status, not string:
if (post.status === Status.Published) { /* … */ }
```

### Custom cast — full get/set control

Pass an object with `get` and `set` functions for complete control over
serialization:

```typescript
// app/models/Place.ts
interface GeoPoint { lat: number; lng: number }

@column({
  type: "string",
  cast: {
    get: (v: unknown): GeoPoint => JSON.parse(v as string),
    set: (v: unknown): string  => JSON.stringify(v),
  },
})
location!: GeoPoint;

// You now work with a typed object, not a raw string:
console.log(place.location.lat, place.location.lng);
```

## Reusable casts

For a cast you reuse across models, extend the `Cast` base class instead of
repeating an inline `{ get, set }` object. Put your cast in `app/casts/` and
pass an instance:

```typescript
// app/casts/MoneyCast.ts
import { Cast } from "@zerotal/orm";

export class MoneyCast extends Cast<number> {
  get(db: unknown) {
    return Number(db) / 100;
  } // cents → dollars
  set(v: number) {
    return Math.round(v * 100);
  }
}
```

```typescript
// app/models/Invoice.ts
import { column } from "@zerotal/orm";
import { MoneyCast } from "../casts/MoneyCast.ts";

@column({ cast: new MoneyCast() }) total!: number;
```

For JSON columns the ORM ships ready-made helpers that optionally hydrate the
parsed value into a class:

```typescript
// app/models/Customer.ts
import { column } from "@zerotal/orm";
import { json, objectOf, arrayOf } from "@zerotal/orm";
import { Address } from "../value-objects/Address.ts";

@column({ cast: json<Settings>() })   settings!: Settings;   // typed plain JSON
@column({ cast: objectOf(Address) })  billing!: Address;     // hydrate one object
@column({ cast: arrayOf(Address) })   addresses!: Address[]; // hydrate a list
```

> **Tip** — A class passed to `objectOf`/`arrayOf` is hydrated without invoking
> its constructor (via `Object.assign` on the prototype). Define a static
> `fromJSON(raw)` on the class to customise how a row is rebuilt.

## static casts map

An alternative to `@column()` for columns you don't declare directly (e.g. from
an external schema, a view, or a generated table):

```typescript
// app/models/Post.ts
@table("posts")
export class Post extends Model {
  static casts = {
    publishedAt: "datetime",
    meta: "json",
    price: "decimal:2",
    active: "boolean",
  } as const;
}
```

`static casts` and `@column()` can coexist. Casts are merged up the prototype
chain, so a subclass inherits its parent's casts without re-declaring them.

> **Warning** — When a column is declared in **both** `static casts` and
> `@column()`, the `static casts` entry wins — it is checked first during
> hydration. Pick one place to define a column's cast to avoid surprises.

### Which should I use?

- **`@column("…")` shorthand** — the default. Co-locates the cast with the
  property and gives you the TypeScript type in one place.
- **`@column({ cast })` object / `Cast` class** — when you need a custom
  transform, a `decimal:N`/`enum` option, or a reusable cast shared by several
  models.
- **`static casts` map** — when the property isn't declared with `@column()`
  (external/generated schemas) or you want all casts listed in one table.

## Reactive JSON casts

By default, mutating a nested JSON property directly (e.g. `post.meta.views++`)
does not mark the column dirty and won't be persisted on the next `save()`.
Enable `reactiveCasts` to make `json` and `array` columns use a reactive proxy
that tracks deep mutations:

```typescript
// app/models/Post.ts
@table("posts")
export class Post extends Model {
  static reactiveCasts = true;

  @column("json") meta!: Record<string, unknown>;
}

const post = await Post.find(1);

// With reactiveCasts = true, this nested mutation IS tracked:
post.meta.views = (post.meta.views as number) + 1;
await post.save(); // persists the updated meta
```

Without `reactiveCasts`, replace the whole value to ensure dirty tracking:

```typescript
// in a controller
post.meta = { ...post.meta, views: (post.meta.views as number) + 1 };
await post.save();
```

> **Note** — Enable `reactiveCasts` per model. There is no performance cost on
> models that don't use it.

## Cast application order

Casts are applied:

- **On read** — immediately after the row is hydrated from the database.
- **On write** — just before the value is sent to the database in `save()`,
  `create()`, or `update()`.
- **In dirty tracking** — the hydrated (post-read-cast) value is captured as the
  original, so `isDirty()` reflects actual changes, not cast-representation
  differences.

## References

Custom-cast surface, all exported from `@zerotal/orm`:

| Member                 | Signature                                      | Description                                                |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `Cast<T>`              | `abstract class Cast<T> { get(db); set(v) }`   | Base class for a reusable custom cast.                     |
| `CastContract<T>`      | `interface { get(db): T; set(v: T): unknown }` | The shape any `{ get, set }` cast must satisfy.            |
| `json<T>(mapper?)`     | `(mapper?: CastMapper<T>) => JsonCast<T>`      | Cast a JSON column to a typed object, optionally hydrated. |
| `objectOf<T>(mapper?)` | `(mapper?: CastMapper<T>) => JsonCast<T>`      | Alias of `json`, reads nicely with a class.                |
| `arrayOf<T>(mapper?)`  | `(mapper?: CastMapper<T>) => ArrayCast<T>`     | Cast a JSON column to an array of typed values.            |

Cast options accepted by `@column()`:

| Option       | Type                                                | Description                                     |
| ------------ | --------------------------------------------------- | ----------------------------------------------- |
| `cast`       | shorthand string, `{ get, set }`, or `CastContract` | The transform applied on read/write.            |
| `enumValues` | `Record<string, string \| number>`                  | The TS enum object, paired with `cast: "enum"`. |

## Next steps

- [ORM](/docs/orm/index) — defining models and columns.
- [Queries](/docs/orm/queries) — the query builder and scopes.
- [Serialization](/docs/orm/serialization) — control JSON output.
- [Carbon](/docs/carbon) — the date type behind `datetime` casts.
