---
name: zerotal-schema-changes
description: "Add or change a database column in a Zerotal app — deciding whether a migration is required, writing one that is safe to re-run, and the mixin columns that need one even though nothing declares them."
---

<!-- zerotal:arch:generated -->

# Changing the schema

**Both are in play here** — `database.synchronize` is on _and_ migrations exist. Run `doctor` and read the source-of-truth line before you touch anything.

## Decide who owns the schema before writing anything

Two arrangements, and they need different work for the same change:

- **Models own it** (`database.synchronize`). The table is built from what the models
  declare. A `@column` is the whole change; there is no migration to write.
- **Migrations own it.** The table is built from what a migration says. A `@column` alone
  changes nothing on disk, and every query touching it fails at runtime.

`bun zt doctor` reports which. Ask it rather than guessing — the failure mode for guessing
wrong is a clean type-check and a runtime error under load.

## The columns nothing declares

Some mixins register a column imperatively rather than with `@column` — `EmailVerification`
adds `email_verified_at`, `Authenticatable` adds `remember_token`. A boot-time concern
adds those to their table **if the table already exists**.

It never creates a table, and it never revisits one. So where migrations own the schema, a
`create users` migration that does not mention `email_verified_at` produces a table
without it, permanently:

```
SQLiteError: no such column: email_verified_at
```

Composing such a mixin in a migrations-owned app means writing the migration too.

## Write the migration so it can meet a database that already has the column

The concern above may already have added it — on any database that has booted the app since
the mixin was composed. An unguarded `ALTER TABLE` then fails with `duplicate column name`,
during the release's `migrate` step:

```ts
import { Schema } from "@zerotal/orm";

export default class extends Migration {
  async up(): Promise<void> {
    if (!(await Schema.hasColumn("users", "email_verified_at"))) {
      await Schema.table("users", (table) => {
        table.dateTime("email_verified_at").nullable();
      });
    }
  }
}
```

## Sequence

1. `bun zt doctor` — who owns the schema.
2. `bun zt make:migration` if migrations do. Never hand-edit one that has run: the runner
   records it as applied and will not run it again, so the edit reaches no database that
   already migrated.
3. Call the `schema` tool afterwards to confirm the column is really there. It reads the
   database, not the models, which is the difference that matters here.
4. `bun zt test`.
