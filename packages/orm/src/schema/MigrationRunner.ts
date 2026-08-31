import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SQLInstance } from "../db/sql-types.ts";
import type { Migration } from "./Migration.ts";
import { MigrationError } from "../errors/MigrationError.ts";
import { FrameworkEvents } from "@zerotal/core";
import { MigrationRan } from "../events.ts";
import { dialectFor } from "../db/QueryBuilder.ts";
import { getDialect } from "../db/dialects/index.ts";
import { TransactionContext } from "../db/TransactionContext.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export interface MigrationEntry {
  /** Unique migration name, e.g. "2024_01_01_000000_create_users_table". */
  name: string;
  migration: Migration;
}

export interface MigrationRecord {
  name: string;
  instance: Migration;
}

export interface MigrationStatus {
  name: string;
  ran: boolean;
  batch?: number;
  ranAt?: Date;
}

interface MigrationRow {
  id: number;
  migration: string;
  batch: number;
  ran_at: string;
}

// ── MigrationRunner ───────────────────────────────────────────────────────────

/**
 * Executes and tracks migrations against a `Bun.sql` connection.
 *
 * Applied migrations are recorded in a tracking table (default `"migrations"`) by
 * name and batch, so re-runs skip already-applied entries and rollbacks can undo a
 * whole batch. Every run/rollback emits a `MigrationRan` framework event (success
 * or failure) for observability.
 *
 * ## The all-or-nothing guarantee
 *
 * On an engine with transactional DDL — PostgreSQL and SQLite — each migration and
 * its tracking-table row are written in **one transaction**. A migration that
 * throws half way leaves nothing behind: not the tables it managed to create, and
 * not a row claiming it ran. That is what makes `zt deploy:<env>` safe to retry,
 * because the only two states a deploy can be interrupted in are "not applied" and
 * "applied and recorded".
 *
 * Three things had to be true for that to hold, and none of them were:
 *
 * 1. **The migration's statements must run on the transaction.** `Schema` resolved
 *    the *global* connection, so DDL inside the runner's `begin()` executed on a
 *    pooled connection and committed independently. The wrapper was decorative.
 * 2. **The tracking insert must be inside it.** Recording after the commit leaves
 *    a window where the schema has moved and the record says otherwise — the
 *    migration runs a second time on the next deploy, against a schema it has
 *    already changed.
 * 3. **The engine must actually support it.** MySQL implicitly commits on DDL, so
 *    a transaction there is a promise that cannot be kept.
 *
 * ## MySQL
 *
 * No transactional DDL, so migrations run unwrapped and a failure leaves the
 * statements that already succeeded in place. `willRollBackOnFailure` reports
 * this, and `zt migrate` says so before it starts rather than after it breaks.
 * Keeping each migration small is the only mitigation the engine allows.
 *
 * @example
 * ```ts
 * const runner = new MigrationRunner({ connection: sql });
 * await runner.runFromDirectory('./database/migrations'); // apply pending
 * await runner.rollbackFromDirectory('./database/migrations'); // undo last batch
 * ```
 */
export class MigrationRunner {
  private readonly _conn: SQLInstance;
  private readonly _table: string;

  /**
   * @param options.connection - The `Bun.sql` connection to run DDL/DML against.
   * @param options.table - Tracking-table name; defaults to `"migrations"`.
   */
  constructor(options: { connection: SQLInstance; table?: string }) {
    this._conn = options.connection;
    this._table = options.table ?? "migrations";
  }

  /**
   * Whether a failed migration will be rolled back on this connection's engine.
   *
   * `false` on MySQL/MariaDB, where DDL implicitly commits. Callers surface this
   * before running anything — a developer who knows a failure will leave a
   * half-applied schema writes smaller migrations and takes a backup first.
   */
  get willRollBackOnFailure(): boolean {
    return getDialect(dialectFor(this._conn)).supportsTransactionalDdl;
  }

  /**
   * Run `work` inside a transaction, or directly when the engine cannot roll DDL
   * back.
   *
   * The transaction connection is published on {@link TransactionContext}, which
   * is what `Schema` (and anything else the migration touches) resolves through.
   * Without that the statements run on a pooled connection and commit on their
   * own, which is precisely the bug this method exists to close — so the ALS is
   * not an optimisation here, it is the entire mechanism.
   */
  private async _atomically(work: () => Promise<void>): Promise<void> {
    if (!this.willRollBackOnFailure) {
      await work();
      return;
    }
    await this._conn.begin(async (tx: SQLInstance) => {
      await TransactionContext.run(tx, work);
    });
  }

  /**
   * The connection this runner's own statements go to: the open transaction when
   * there is one, otherwise the connection it was constructed with.
   *
   * The tracking-table writes need this as much as the migration does. An INSERT
   * that went to the pool while the DDL went to the transaction would record a
   * migration the transaction could still roll back.
   */
  private _active(): SQLInstance {
    return TransactionContext.getStore() ?? this._conn;
  }

  /**
   * Run all pending migrations from the provided list.
   *
   * - Skips any entry whose name is already in the migrations table.
   * - Executes pending entries in the order given; assigns them all to a new batch.
   * - Returns the names of migrations that were actually executed.
   */
  async run(entries: MigrationEntry[]): Promise<string[]> {
    await this._ensureTable();
    const ran = await this._ranNames();
    const batch = (await this._lastBatch()) + 1;

    const pendingEntries = entries.filter((e) => !ran.has(e.name));
    _refuseLikelyRenames(pendingEntries, ran);

    const executed: string[] = [];

    for (const entry of pendingEntries) {
      const start = performance.now();
      try {
        // The migration and its tracking row in one transaction. Recording after
        // the commit would leave a window where the schema has moved and nothing
        // says so — and the next deploy would run this migration again, against a
        // schema it has already changed.
        await this._atomically(async () => {
          await entry.migration.up();
          await this._record(entry.name, batch);
        });
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        FrameworkEvents.emit(
          new MigrationRan(
            entry.name,
            "up",
            Math.round(performance.now() - start),
            false,
            cause.message,
          ),
        );
        throw new MigrationError(entry.name, cause);
      }
      FrameworkEvents.emit(
        new MigrationRan(entry.name, "up", Math.round(performance.now() - start), true),
      );
      executed.push(entry.name);
    }

    return executed;
  }

  /**
   * Roll back the last batch of migrations in reverse order.
   *
   * `entries` must include all migration objects so the runner can locate
   * the correct `down()` implementation for each name in the last batch.
   *
   * Returns the names of migrations that were rolled back.
   */
  async rollback(entries: MigrationEntry[]): Promise<string[]> {
    await this._ensureTable();
    const batch = await this._lastBatch();
    if (batch === 0) return [];

    const batchNames = await this._namesForBatch(batch);
    const byName = new Map(entries.map((e) => [e.name, e]));

    // A recorded migration whose file is gone has no down() to run, so the batch cannot be
    // rolled back correctly. Refuse before touching anything: silently skipping it left the
    // schema and the tracking table inconsistent — the batch's other migrations were undone
    // while their records stayed — and left reset() looping forever, since the batch never
    // emptied and _lastBatch() kept returning it.
    const missing = batchNames.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(
        `[Zerotal ORM] Cannot roll back batch ${batch}: no migration file found for ` +
          `${missing.map((n) => `"${n}"`).join(", ")}.\n` +
          `Restore the file(s), or delete the row(s) from the migrations table if the ` +
          `migration is genuinely gone and its schema change is already reversed.`,
      );
    }

    // Reverse order — last migration is undone first
    const toRollback = [...batchNames].reverse().map((n) => byName.get(n)!);
    const rolledBack: string[] = [];

    for (const entry of toRollback) {
      const start = performance.now();
      try {
        // Same guarantee in reverse: a `down()` that fails half way leaves neither
        // a partly-undone schema nor a deleted record claiming it was undone.
        await this._atomically(async () => {
          await entry.migration.down();
          await this._deleteRecord(entry.name);
        });
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        FrameworkEvents.emit(
          new MigrationRan(
            entry.name,
            "down",
            Math.round(performance.now() - start),
            false,
            cause.message,
          ),
        );
        throw err;
      }
      FrameworkEvents.emit(
        new MigrationRan(entry.name, "down", Math.round(performance.now() - start), true),
      );
      rolledBack.push(entry.name);
    }

    return rolledBack;
  }

  /**
   * Return names of migrations from `entries` that have not yet been run.
   */
  async pending(entries: MigrationEntry[]): Promise<string[]> {
    await this._ensureTable();
    const ran = await this._ranNames();
    return entries.filter((e) => !ran.has(e.name)).map((e) => e.name);
  }

  /**
   * Roll back every batch, running `down()` from newest to oldest.
   */
  async reset(entries: MigrationEntry[]): Promise<void> {
    await this._ensureTable();
    let batch = await this._lastBatch();
    while (batch > 0) {
      await this.rollback(entries);
      batch = await this._lastBatch();
    }
  }

  /**
   * Report which migrations from `entries` have run.
   */
  async status(entries: MigrationEntry[]): Promise<MigrationStatus[]> {
    await this._ensureTable();
    const records = await this._allRecords();
    const byName = new Map(records.map((r) => [r.migration, r]));

    return entries.map((e) => {
      const rec = byName.get(e.name);
      return rec
        ? {
            name: e.name,
            ran: true,
            batch: rec.batch,
            ranAt: new Date(rec.ran_at),
          }
        : { name: e.name, ran: false };
    });
  }

  /**
   * Load migration files from a directory, sort alphabetically, and run.
   *
   * Files must export a default class that extends Migration.
   * Skips non-.ts files.
   */
  async runFromDirectory(dir: string): Promise<string[]> {
    const entries = await this._loadDirectory(dir);
    return this.run(entries);
  }

  /**
   * Load migration files from a directory and roll back the last batch.
   * @returns Names of the migrations that were rolled back.
   */
  async rollbackFromDirectory(dir: string): Promise<string[]> {
    const entries = await this._loadDirectory(dir);
    return this.rollback(entries);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _ensureTable(): Promise<void> {
    // The tracking table is the very first DDL a project ever runs, so a SQLite-only
    // `INTEGER PRIMARY KEY AUTOINCREMENT` here meant `migrate` against PostgreSQL or MySQL
    // failed before it reached a single application migration.
    const id = getDialect(dialectFor(this._conn)).autoIncrementColumn("id");
    await this._ddl(`
      CREATE TABLE IF NOT EXISTS ${this._table} (
        ${id},
        migration TEXT    NOT NULL UNIQUE,
        batch     INTEGER NOT NULL,
        ran_at    TEXT    NOT NULL
      )
    `);
  }

  private async _ranNames(): Promise<Set<string>> {
    const rows = await this._select<{ migration: string }>(`SELECT migration FROM ${this._table}`);
    return new Set(rows.map((r) => r.migration));
  }

  private async _lastBatch(): Promise<number> {
    const rows = await this._select<{ b: number | null }>(
      `SELECT MAX(batch) as b FROM ${this._table}`,
    );
    return rows[0]?.b ?? 0;
  }

  private async _namesForBatch(batch: number): Promise<string[]> {
    const rows = await this._selectParam<{ migration: string }>(
      `SELECT migration FROM ${this._table} WHERE batch = ? ORDER BY id ASC`,
      batch,
    );
    return rows.map((r) => r.migration);
  }

  private async _allRecords(): Promise<MigrationRow[]> {
    return this._select<MigrationRow>(
      `SELECT id, migration, batch, ran_at FROM ${this._table} ORDER BY id ASC`,
    );
  }

  private async _record(name: string, batch: number): Promise<void> {
    const now = new Date().toISOString();
    await this._exec(
      `INSERT INTO ${this._table} (migration, batch, ran_at) VALUES (?, ?, ?)`,
      name,
      batch,
      now,
    );
  }

  private async _deleteRecord(name: string): Promise<void> {
    await this._exec(`DELETE FROM ${this._table} WHERE migration = ?`, name);
  }

  /** Execute a DDL string with no parameters. */
  private async _ddl(sql: string): Promise<void> {
    const strings = [sql];
    const tpl = Object.assign(strings, {
      raw: strings,
    }) as TemplateStringsArray;
    await this._active()(tpl);
  }

  /** SELECT with no bound parameters. */
  private async _select<T>(sql: string): Promise<T[]> {
    return this._exec0<T>(sql);
  }

  /** SELECT with exactly one bound parameter. */
  private async _selectParam<T>(sql: string, value: unknown): Promise<T[]> {
    const parts = sql.split("?");
    const tpl = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
    return this._active()<T>(tpl, value);
  }

  /** DML with N bound parameters. */
  private async _exec(sql: string, ...values: unknown[]): Promise<void> {
    const parts = sql.split("?");
    const tpl = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
    await this._active()(tpl, ...values);
  }

  private async _exec0<T>(sql: string): Promise<T[]> {
    const strings = [sql];
    const tpl = Object.assign(strings, {
      raw: strings,
    }) as TemplateStringsArray;
    return this._active()<T>(tpl);
  }

  private async _loadDirectory(dir: string): Promise<MigrationEntry[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith(".ts") || f.endsWith(".js"))
      .sort();

    const entries: MigrationEntry[] = [];
    for (const file of files) {
      // Resolved to a file:// URL, not joined as a string. `database/migrations`
      // is a perfectly ordinary way to configure this directory, and importing
      // `database/migrations/0001_x.ts` verbatim asks the module resolver for a
      // *package* by that name — which fails with "Cannot find module" even
      // though `readdirSync` just listed the file. A URL also keeps Windows
      // drive letters from being read as a protocol.
      const fullPath = pathToFileURL(resolve(dir, file)).href;
      // Dynamic import — each migration file must have a default export
      const mod = (await import(fullPath)) as { default: new () => Migration };
      const Ctor = mod.default;
      // A declared `static id` wins over the filename — see `Migration.id`. Without
      // it, renaming a file makes an applied migration look pending.
      const declared = (Ctor as { id?: string }).id;
      entries.push({
        name: declared ?? file.replace(/\.(ts|js)$/, ""),
        migration: new Ctor(),
      });
    }
    return entries;
  }
}

/**
 * Refuse to run a "pending" migration that is almost certainly a renamed applied one.
 *
 * A migration is recorded under a name, and the next run compares files against those
 * names — so renaming a file makes an applied migration look pending. The runner then
 * tries it again and it fails on `table already exists`, which is a failed boot rather
 * than a graceful skip, and the error names a table rather than the rename that caused
 * it.
 *
 * An app renumbered `001_` to `0001_` to match this framework's own scaffold
 * convention and would have made all nine of its production migrations look unrun.
 * They caught it by reading, not by being told.
 *
 * The signal is precise enough to act on: a pending migration whose name matches a
 * recorded one once the leading digits are stripped is a renumbering, not a new
 * migration. Nobody writes `0001_create_users` alongside an applied
 * `001_create_users` and means two different things.
 *
 * This refuses rather than warns because the alternative is running it — and running
 * it is the outage. {@link Migration.id} is the way to make the rename permanent.
 *
 * @param pending - Migrations about to run.
 * @param ran - Names already recorded.
 * @throws {@link MigrationError} naming both spellings and the fix.
 * @internal
 */
export function _refuseLikelyRenames(pending: MigrationEntry[], ran: Set<string>): void {
  /** The name with any leading ordinal removed: `0001_create_users` → `create_users`. */
  const withoutOrdinal = (name: string): string => name.replace(/^[0-9]+[_-]?/, "");

  const appliedBySuffix = new Map<string, string>();
  for (const name of ran) appliedBySuffix.set(withoutOrdinal(name), name);

  for (const entry of pending) {
    const suffix = withoutOrdinal(entry.name);
    // A bare ordinal strips to nothing; two of those are not evidence of anything.
    if (suffix === "") continue;
    const applied = appliedBySuffix.get(suffix);
    if (applied === undefined || applied === entry.name) continue;

    throw new MigrationError(
      entry.name,
      new Error(
        `"${entry.name}" looks like "${applied}", which has already run — the same ` +
          `migration renumbered rather than a new one. Running it would apply a schema ` +
          `change that is already applied, and fail on the first table it creates.

` +
          `  If it IS the same migration: rename the file back to "${applied}", or keep ` +
          `the new filename and pin the identity to what the database already holds:
` +
          `    static override id = "${applied}";

` +
          `  If it is genuinely a new migration, give it a name that does not collide ` +
          `once the leading digits are removed.`,
      ),
    );
  }
}
