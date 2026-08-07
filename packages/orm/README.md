# @zerotal/orm

> Active Record ORM for Bun — models, migrations, and a fluent query builder on top of `Bun.sql`.

`@zerotal/orm` maps TypeScript classes to database tables: declare columns with decorators, define relationships, and read/write data through a chainable query builder. It supports SQLite, PostgreSQL, and MySQL with the same model code, plus migrations, soft deletes, eager loading, and pagination.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/orm
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { DatabaseProvider } from "@zerotal/orm";

export default [
  // …your other providers
  DatabaseProvider,
];
```

Configure a connection in `config/database.ts`:

```ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "@zerotal/core";

export default DatabaseConfig({
  driver: env("DB_DRIVER", "sqlite"), // 'sqlite' | 'postgres' | 'mysql'
  url: env("DATABASE_URL", "./database/db.sqlite"),
  replicas: [], // optional read-replica URLs
});
```

## Usage

### Define a model

```ts
import { BaseModel, column, table, belongsTo, hasMany } from "@zerotal/orm";
import type { Columns } from "@zerotal/orm";

@(table("posts").withTimestamps().withSoftDeletes())
export class Post extends BaseModel {
  static fillable: Columns<Post>[] = ["title", "body", "status", "userId"];

  @column("string") title!: string;
  @column("text") body!: string;
  @column("string") status!: string;
  @column("integer") userId!: number;

  @belongsTo(() => User, { foreignKey: "userId" })
  author!: User;

  @hasMany(() => Comment, { foreignKey: "postId" })
  comments!: Comment[];
}
```

### Query records

```ts
const post = await Post.find(1); // or findOrFail(1) to throw
const published = await Post.query()
  .where("status", "published")
  .orderBy("created_at", "desc")
  .get<Post>();

const created = await Post.create({ title: "Hello", body: "…", status: "draft" });

post.fill({ title: "Updated" });
await post.save();

await post.delete(); // soft delete (table has .withSoftDeletes())
await post.restore(); // un-delete
await post.forceDelete(); // permanent
```

### Paginate

```ts
const page = await Post.query()
  .where("status", "published")
  .orderBy("created_at", "desc")
  .paginate(15, Number(http.query("page", "1")));

page.data; // Post[] for this page
page.total; // total matching rows
page.lastPage; // number of pages
```

### Migrations

```ts
import { Migration, Schema } from "@zerotal/orm";

export default class CreatePostsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.integer("user_id").index();
      table.string("title");
      table.text("body");
      table.softDeletes();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("posts");
  }
}
```

Run them with `bun zt migrate` (`--fresh`, `migrate:rollback`, `migrate:status` also available).

### Raw query builder

```ts
import { DB } from "@zerotal/orm";

const rows = await DB.table("settings").where("key", "theme").first();
await DB.table("settings").upsert(
  { key: "theme", value: "dark" },
  { key: "theme" },
  { value: "dark" },
);
```

## Exports

This package exposes two subpath entry points:

| Subpath       | Contents                                                                          |
| ------------- | --------------------------------------------------------------------------------- |
| `.` (default) | The full ORM runtime — see the table below.                                       |
| `./commands`  | CLI command classes used by the `zerotal` binary (`make:model`, `migrate`, etc.). |

Main exports from the default entry point:

- **Models** — `BaseModel` / `Model`, `ModelQueryBuilder`, `DB`, `QueryBuilder`
- **Decorators** — `column`, `table`, `belongsTo`, `hasMany`, `hasOne`, `manyToMany`, `morphTo`, `morphMany`, `morphOne`, `hasManyThrough`, `hasOneThrough`, `morphToMany`, `morphedByMany`
- **Schema / migrations** — `Schema`, `Blueprint`, `Migration`, `MigrationRunner`, `SchemaInspector`, `ModelInspector`, `SchemaDiffer`, `synchronizeSchema`
- **Seeding** — `Seeder`
- **Casts** — `Cast`, `JsonCast`, `ArrayCast`, `json`, `objectOf`, `arrayOf`
- **Hooks & observers** — `HookRegistry`, `ModelObserver`
- **N+1 detection** — `preventNPlusOne`, `allowNPlusOne`, `NPlusOneError`
- **Errors** — `ModelNotFoundError`, `RelationNotLoadedError`, `TransactionError`, `MigrationError`, `StateError`
- **Provider & config** — `DatabaseProvider`, `DatabaseConfig`
- **Types** — `Columns`, `InsertPayload`, `UpdatePayload`, `PaginateResult`, `CursorPaginateResult`, and more

## Documentation

- [ORM overview](../../docs/orm/index.md)
- [Queries](../../docs/orm/queries.md)
- [Relationships](../../docs/orm/relationships.md)
- [Casts & Mutators](../../docs/orm/casts.md)
- [Lifecycle & Events](../../docs/orm/lifecycle.md)
- [Serialization](../../docs/orm/serialization.md)
- [Factories](../../docs/orm/factories.md)
- [Query Builder](../../docs/query-builder.md)
- [Migrations](../../docs/migrations.md)
- [Pagination](../../docs/pagination.md)
- [Seeding](../../docs/seeding.md)
