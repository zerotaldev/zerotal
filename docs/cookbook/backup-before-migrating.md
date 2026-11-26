---
title: A Backup Before Migrating
description: Snapshot the SQLite database with db:backup before running a migration, check the snapshot, and undo the migration with a rollback or by restoring the file.
---

# A Backup Before Migrating

A migration changes the one thing a deploy cannot rebuild: the data. This recipe adds a
column to the starter's `projects` table the careful way. At the end you will have taken
a verified snapshot, previewed the SQL, migrated, checked the result, and seen both ways
back: a rollback, and a restore of the snapshot. Last, you will have `migrate` take the
snapshot itself in production.

## Before you start

The starter uses SQLite, and its database is the single file `database/db.sqlite`. Run
`bun zt migrate` once if you have not, and `bun zt db:seed` to give it some rows.

Everything here is built in: `db:backup` and the migration commands come with the
`zerotal` package, and the backup uses SQLite's own `VACUUM INTO`, so there is nothing to
install, not even the `sqlite3` command-line tool. `db:backup` is SQLite only. On
PostgreSQL or MySQL it refuses and points you at `pg_dump` or `mysqldump`.

The outputs on this page leave out the timestamped log lines each command prints, and
`…` marks anything else left out.

## The migration

```bash
# in your project root
bun zt make:migration add_priority_to_projects
```

```
Created: database/migrations/0007_add_priority_to_projects.ts
```

Replace the generated table-creating stub with the column:

```ts
// database/migrations/0007_add_priority_to_projects.ts
import { Migration, Schema } from "zerotal/orm";

export default class AddPriorityToProjects extends Migration {
  override async up(): Promise<void> {
    if (await Schema.hasColumn("projects", "priority")) return;

    await Schema.table("projects", (table) => {
      table.string("priority").default("normal");
    });
  }

  override async down(): Promise<void> {
    await Schema.table("projects", (table) => {
      table.dropColumn("priority");
    });
  }
}
```

The `hasColumn` guard lets `up()` run against a database that already has the column,
and `down()` is written now, while you know exactly what `up()` did. A rollback is only
as good as the `down()` behind it.

## Back up

```bash
# in your project root
bun zt db:backup --require-rows=users,projects --rehearse
```

```
Database backup
source     ./database/db.sqlite
directory  storage/backups
keep       14

Wrote storage/backups/db-20261126-154231.sqlite
  size                 …
  tables               …
  integrity            ok
  rows in users        …
  rows in projects     …
  restore rehearsed    yes
```

The counts and the size are your database's. What the command checked before it
printed them:

- **The snapshot is a database.** It is opened and its `PRAGMA integrity_check` must
  come back `ok`.
- **`--require-rows` tables are not empty.** A snapshot with an empty `users` table is a
  failure, and a byte count would never show it. Name the tables your app cannot lose.
- **`--rehearse` restores it once.** The snapshot is copied, the copy is opened and
  checked, and the copy is deleted: the operation you would perform in an emergency, done
  while nothing is wrong.

Any failure exits non-zero, so a script can stop on it: `bun zt db:backup … && bun zt
migrate` never migrates without a good copy. `--keep` (default 14) is how many snapshots
the directory holds before the oldest are deleted. The snapshot ends in `.sqlite`, which
the starter's `.gitignore` already keeps out of version control.

Why not `cp database/db.sqlite`? A live SQLite database has pages in flight and a
write-ahead log beside it, so a copy taken while the server is writing can be a corrupt
file that nobody notices until they need it. `VACUUM INTO` takes a read lock and writes a
complete database while the server keeps serving.

## Preview, then migrate

`--pretend` prints the SQL the pending migrations would send, and sends none of it:

```bash
# in your project root
bun zt migrate --pretend
```

```
0007_add_priority_to_projects
SELECT name FROM pragma_table_info(?) WHERE name = ?;
  -- bindings: ["projects","priority"]
ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';

Pretended: nothing was run or recorded. Reads return no rows here, so a migration that branches on hasTable() or on data shows the empty-database path.
```

That is the change you meant. Run it:

```bash
# in your project root
bun zt migrate
```

```
Migrated 1 migration(s).
  0007_add_priority_to_projects    ran
```

On SQLite, each migration and its record in the `migrations` table are written in one
transaction. A migration that throws half way leaves nothing behind, so a failed
migration needs a fix and another `migrate`, not the backup. The backup is for the
migration that succeeds and turns out to be wrong.

## Check it

```bash
# in your project root
bun zt migrate:status
```

```
  name                                       ran | batch | ranAt
  …
  0006_create_projects_table                 yes | 1 | …
  0007_add_priority_to_projects              yes | 2 | …
```

The new migration ran in a batch of its own. Your batch numbers depend on how often you
have migrated. Then look at the data. This reads the file directly with Bun's built-in
SQLite driver, read-only:

```bash
# in your project root
bun -e 'import { Database } from "bun:sqlite"; const db = new Database("database/db.sqlite", { readonly: true }); console.log(db.query("SELECT COUNT(*) AS without_priority FROM projects WHERE priority IS NULL").get());'
```

```
{
  without_priority: 0,
}
```

Every existing project got the default. Run `bun zt test` as well: the tests build their
schema from the same migrations, so a migration that breaks a query shows up there.

## If it went wrong: roll back

`migrate:rollback` runs `down()` for every migration in the last batch:

```bash
# in your project root
bun zt migrate:rollback
```

```
Rolled back 1 migration(s).
  0007_add_priority_to_projects    rolled back
```

This is the right tool when `down()` really reverses `up()`, as dropping an added column
does. It is the wrong one when the migration destroyed something: a `down()` can put a
dropped column back, but not the values that were in it, and it cannot un-run an
`UPDATE` that overwrote a column. For that, restore the snapshot.

## If it went wrong: restore the snapshot

There is no restore command. The snapshot is a complete SQLite database, so restoring it
means putting that file where the app's database is:

1. **Stop the server and the queue worker.** Nothing may have the database open while
   its file is replaced.
2. **Move the current database aside**, with its `-wal` and `-shm` files. A write-ahead
   log left next to a different database file can be replayed into it. Keep the old file
   until you are sure you do not need anything from it.
3. **Copy the snapshot into place.** Copy rather than move it, so the snapshot stays in
   `storage/backups` in case you need it again.

```bash
# in your project root
mkdir -p storage/before-restore
mv database/db.sqlite* storage/before-restore/
cp storage/backups/db-20261126-154231.sqlite database/db.sqlite
bun zt migrate:status
```

```
  name                                       ran | batch | ranAt
  …
  0006_create_projects_table                 yes | 1 | …
  0007_add_priority_to_projects              no | - | -
```

The database is the one from before the migration, so the migration is pending again.
Fix it, or delete the file, before anything runs `migrate`: the next `migrate`, or the
next deploy, would run it again. Then start the server.

Anything written between the snapshot and the restore is gone, which is why the
snapshot is taken immediately before migrating and not the night before.

## In production, let `migrate` take it

Set `backupBeforeMigrate` in `config/database.ts`:

```ts
// config/database.ts
import { env } from "zerotal";
import { DatabaseConfig } from "zerotal/orm";

export default DatabaseConfig({
  // The driver has to agree with the URL's protocol — boot validation rejects a
  // sqlite driver pointed at postgres:// or mysql://. Change both together.
  driver: "sqlite",

  // ZT_DB_URL first: `bun zt test` sets it (defaults to :memory:) and that
  // override has to beat the DATABASE_URL in .env, or the suite would run
  // against your development database and leave its rows behind.
  url: env("ZT_DB_URL", env("DATABASE_URL", "./database/db.sqlite")),

  // Off deliberately. This template ships baseline migrations in
  // database/migrations, and boot-time schema sync would create the same tables
  // from the models first — so the very first `bun zt migrate` would fail with
  // "table users already exists". Migrations are the single source of truth, in
  // development exactly as in production; run `bun zt migrate` after scaffolding.
  synchronize: false,

  // In production, `migrate` (and so `deploy:production`) snapshots the SQLite file into
  // storage/backups/pre-migrate/ before it changes anything, and stops if that fails.
  backupBeforeMigrate: true,
});
```

It applies only when `APP_ENV` is `production`, `prod` or `staging`, and only when there
is something to migrate, so your development `migrate` is unchanged. To see it, run a
pending migration with the production environment:

```bash
# in your project root
APP_ENV=production bun zt migrate
```

```
Backup before migrate
Wrote storage/backups/pre-migrate/db-20261126-154243.sqlite

Migrated 1 migration(s).
  0007_add_priority_to_projects    ran
```

The snapshot is integrity-checked like any other, and if it cannot be taken, `migrate`
stops without migrating. The newest 14 are kept in `storage/backups/pre-migrate/`, apart
from the ones you take yourself. Restoring one is the same procedure as above.

`deploy:production` runs `migrate` as one of its steps, so the same setting covers every
release. With the production environment loaded, the migrate step of a deploy prints:

```bash
# on the box, with that environment's variables loaded
APP_ENV=production bun zt deploy:production
```

```
…
migrate

Backup before migrate
Wrote storage/backups/pre-migrate/db-20261126-154245.sqlite

Migrated 1 migration(s).
  0007_add_priority_to_projects    ran
…
```

The pre-migrate snapshot runs without `--require-rows`, so keep the nightly
`db:backup --require-rows=…` as well: it is the one that proves the business is in the
file.

## See also

- [Migrations](/docs/migrations#a-backup-before-migrating-in-production) —
  `backupBeforeMigrate`, `--pretend`, and what happens when a migration fails.
- [Deployment](/docs/deployment#back-up-the-database) — `db:backup`'s flags and a systemd
  timer for nightly snapshots.
- [Commands](/docs/commands#database) — every database command.
- [Deploy It](/docs/tutorial/deploy) — the tutorial's production release.
