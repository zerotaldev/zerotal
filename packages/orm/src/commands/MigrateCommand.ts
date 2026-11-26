import { Command, ZerotalError, type FlagDef } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection, _rawStatement } from "../db/DB.ts";
import {
  _describeMigrationNumberClashes,
  _partitionMigrationNumberClashes,
  _unappliedMigrationNumberClashes,
} from "../schema/migrationNumbers.ts";
import { _pretendMigration } from "../schema/pretend.ts";
import { loadMigrations } from "./_loadMigrations.ts";
import { _nextMigrationPrefix } from "./MakeMigrationCommand.ts";
import { runSeeders } from "./_runSeeders.ts";
import {
  _PRE_MIGRATE_BACKUP_DIR,
  _backupBeforeMigrate,
  _commandConfig,
} from "./_preMigrateBackup.ts";

/**
 * Runs all pending database migrations (`bun zt migrate`).
 *
 * Loads every migration under `database/migrations/`, then applies those not
 * yet run. Passing `--fresh` first drops all tables and re-runs every
 * migration from scratch; `--seed` runs the seeders afterwards; `--pretend`
 * prints the SQL the pending migrations would send and sends none of it.
 *
 * Refuses to run when two different migration files share a number and one of
 * them has not been applied — two branches that each added "the next one". With
 * `database.backupBeforeMigrate` on, a production run takes a `db:backup`
 * snapshot (SQLite) before anything changes.
 *
 * @example
 * ```bash
 * bun zt migrate
 * bun zt migrate --pretend
 * bun zt migrate --fresh
 * bun zt migrate --fresh --seed
 * ```
 *
 * @category Migrations
 */
export class MigrateCommand extends Command {
  static commandName = "migrate";
  static aliases = ["db:migrate"];
  static description = "Run all pending database migrations";
  static needsApp = true;
  static flags: FlagDef[] = [
    {
      name: "fresh",
      type: "boolean",
      description: "Drop all tables and re-run all migrations",
      default: false,
    },
    {
      name: "seed",
      type: "boolean",
      description: "Run database seeders once migrations have run",
      default: false,
    },
    {
      name: "pretend",
      type: "boolean",
      description: "Print the SQL pending migrations would run, without running it",
      default: false,
    },
    {
      name: "skip-backup",
      type: "boolean",
      description: "Skip the snapshot database.backupBeforeMigrate takes in production",
      default: false,
    },
  ];

  /** Where the pre-migrate snapshot goes: beside the nightly ones, never pruning them. */
  static readonly BACKUP_DIR = _PRE_MIGRATE_BACKUP_DIR;

  async run(): Promise<void> {
    const fresh = this.flags["fresh"] as boolean;
    const records = await loadMigrations();
    const entries: MigrationEntry[] = records.map((r) => ({
      name: r.name,
      migration: r.instance,
    }));

    const runner = new MigrationRunner({ connection: _getConnection() });
    const pending = new Set(await runner.pending(entries));

    // Before anything runs, and before the backup: a clash is a decision for the
    // author, and nothing about it gets better by having touched the database.
    const next = _nextMigrationPrefix(records.map((r) => r.file ?? r.name));
    const { divergent, fresh: unrun } = _partitionMigrationNumberClashes(
      _unappliedMigrationNumberClashes(records, pending),
      records,
      pending,
    );
    if (divergent.length > 0) {
      throw new ZerotalError(
        _describeMigrationNumberClashes(divergent, next),
        "E_MIGRATION_NUMBER_CLASH",
        500,
        { clashes: divergent },
      );
    }
    if (unrun.length > 0) {
      this.warn(_describeMigrationNumberClashes(unrun, next));
      this.dim("  Nothing here has run yet, so they run in name order. Migrating.");
    }

    if (this.flags["pretend"] as boolean) {
      await this.#pretend(
        entries.filter((e) => pending.has(e.name)),
        fresh,
      );
      return;
    }

    if (pending.size > 0 || fresh) await this.#backupFirst();

    // Said before anything runs, not after something breaks. On an engine with
    // transactional DDL a failed migration leaves nothing behind; on MySQL every
    // DDL statement implicitly commits, so a migration that fails half way leaves
    // the half it did — and the operator needs to know which world they are in
    // while they still have the option of taking a backup.
    if (!runner.willRollBackOnFailure && entries.length > 0) {
      this.warn(
        "This database does not support transactional DDL, so a migration that fails " +
          "part-way will leave the statements that already succeeded in place.",
      );
      this.dim("  Keep migrations small, and take a backup before running them in production.");
      this.newLine();
    }

    if (fresh) {
      await runner.reset(entries);
    }

    const ran = await runner.run(entries);

    if (ran.length === 0) {
      this.info("Nothing to migrate.");
    } else {
      this.info(`Migrated ${ran.length} migration(s).`);
      this.table(ran.map((name) => [name, "ran"]));
    }

    // Seeding runs even when nothing migrated: `migrate --seed` against an
    // already-current schema is a normal way to top up a dev database.
    if (this.flags["seed"] as boolean) await this.#seed();
  }

  /**
   * Print what the pending migrations would send, and send nothing.
   *
   * No migration runs and nothing is recorded: no tracking rows, no backup, no
   * seeders. The one write is the one every `migrate` makes first — creating the
   * empty `migrations` table if the database has never had one.
   */
  async #pretend(pending: MigrationEntry[], fresh: boolean): Promise<void> {
    if (fresh) {
      this.warn("--pretend with --fresh shows the pending migrations only; nothing is dropped.");
    }
    if (pending.length === 0) {
      this.info("Nothing to migrate.");
      return;
    }
    for (const entry of pending) {
      this.section(entry.name);
      const statements = await _pretendMigration(entry.migration, _getConnection());
      if (statements.length === 0) this.dim("  (no SQL)");
      for (const statement of statements) {
        this.line(`${statement.sql};`);
        if (statement.params.length > 0)
          this.dim(`  -- bindings: ${JSON.stringify(statement.params)}`);
      }
    }
    this.newLine();
    this.dim(
      "Pretended: nothing was run or recorded. Reads return no rows here, so a migration " +
        "that branches on hasTable() or on data shows the empty-database path.",
    );
  }

  /**
   * Take a snapshot before migrating, when the app asked for one.
   *
   * Opt-in (`database.backupBeforeMigrate`) and production-only: a development
   * database is rebuilt with `migrate:fresh --seed`, and a snapshot of it on every
   * run would only fill the disk. A failed snapshot stops the migration — the app
   * asked not to migrate without one.
   *
   * On PostgreSQL and MySQL this takes nothing and says so. `VACUUM INTO` is a
   * SQLite statement, and a server database is backed up with its own tool or the
   * provider's snapshots; printing "backed up" here would be the one lie a backup
   * step must never tell.
   */
  async #backupFirst(): Promise<void> {
    await _backupBeforeMigrate(this, this.#config(), this.flags["skip-backup"] === true);
  }

  #config(): ConfigManager | undefined {
    return _commandConfig(this);
  }

  /**
   * Seed after migrating.
   *
   * Reported, not thrown: the migrations above already committed, and failing
   * the command here would suggest they need repeating when only the seeders do.
   */
  async #seed(): Promise<void> {
    this.section("Database Seeding");
    const outcome = await runSeeders();

    switch (outcome.status) {
      case "seeded":
        this.info("Database seeded successfully.");
        return;
      case "missing":
        this.error(`Seeder not found: ${outcome.path}`);
        this.dim("Create it with: bun zerotal.ts make:seeder DatabaseSeeder");
        return;
      case "invalid":
        this.error(outcome.message);
        return;
      case "failed":
        this.error(`Failed to run seeders: ${outcome.message}`);
        this.dim("Migrations already ran — re-run `bun zt db:seed` once the seeder is fixed.");
        return;
    }
  }
}
