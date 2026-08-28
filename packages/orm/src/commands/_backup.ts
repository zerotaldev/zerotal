/**
 * Taking a copy of the one file that cannot be rebuilt.
 *
 * SQLite is the framework's default database, which makes the database a single
 * file on disk — and makes `cp` look like a backup. It is not one. A live SQLite
 * database has pages in flight and a write-ahead log beside it; copying the file
 * while the server is serving can capture a half-written page, and the result is a
 * file that looks like a backup, sits in the retention directory for months, and
 * turns out to be a corrupt database on the one morning anybody opens it.
 *
 * `VACUUM INTO` is the answer SQLite ships. It takes a read lock, walks the
 * b-tree, and writes a complete, defragmented database while the server keeps
 * serving. It needs no external binary either — which removes the `apt install
 * sqlite3` step and the failure mode where a backup silently stops working because
 * a base image dropped the CLI.
 *
 * The rest of this module exists because **a backup nobody has restored is a
 * hope.** Every snapshot is opened and integrity-checked the moment it is written,
 * and `rehearse` performs the actual restore — copy the file, open the copy, read
 * it — because that is the operation you will be doing at 3am and it is the one
 * worth knowing works.
 *
 * Every failure path throws. A backup timer that reports success while writing
 * nothing is worse than no timer at all: it buys the confidence without the file.
 *
 * @module
 */
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** How a backup was asked for. */
export interface BackupOptions {
  /** Absolute or cwd-relative path of the live SQLite database. */
  source: string;
  /** Directory snapshots are written into. Created if absent. */
  dir: string;
  /** Snapshots to keep, newest first. `0` keeps every one. */
  keep: number;
  /**
   * Tables that must contain at least one row in the snapshot.
   *
   * The check that turns "a file was written" into "the file has the business in
   * it". An empty `bookings` table in a snapshot of a live system is not a small
   * discrepancy, it is the whole failure — and it is invisible in a byte count.
   */
  requireRows?: string[];
  /**
   * Perform the restore, not just a read of the snapshot: copy it to a scratch
   * path, open the copy, and check it there. Exercises the operation an incident
   * actually needs, rather than the one that is convenient to test.
   */
  rehearse?: boolean;
  /** Clock, so the snapshot name is deterministic under test. */
  now?: Date;
}

/** What a completed backup wrote and proved. */
export interface BackupResult {
  /** Full path of the snapshot. */
  path: string;
  /** Its size on disk. */
  bytes: number;
  /** User tables found in it. */
  tables: string[];
  /** Row counts for the tables named in `requireRows`. */
  rows: Record<string, number>;
  /** Snapshots deleted by retention. */
  pruned: string[];
  /** Whether a full restore round-trip ran. */
  rehearsed: boolean;
}

/** Raised for every way a backup can fail to be a backup. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** Snapshot names this module writes, and therefore the only ones it will delete. */
const SNAPSHOT_PATTERN = /^(.+)-(\d{8}-\d{6})\.sqlite$/;

/**
 * A UTC timestamp that sorts lexically in the same order it sorts chronologically,
 * so retention can order snapshots by filename without parsing dates.
 */
export function backupStamp(now: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

/** The snapshot filename for a source database at a moment. */
export function snapshotName(source: string, now: Date): string {
  const stem = basename(source).replace(/\.(sqlite3?|db)$/i, "") || "database";
  return `${stem}-${backupStamp(now)}.sqlite`;
}

/**
 * A path as a SQLite string literal.
 *
 * `VACUUM INTO` takes an expression, and the driver layer between here and SQLite
 * does not reliably bind a parameter into that position across versions — so the
 * path is inlined, and inlining a path means escaping it. A directory with an
 * apostrophe in it is unusual and is not a reason to write a broken statement.
 */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Whether a database URL points at SQLite rather than a database server. */
export function isSqliteUrl(raw: string): boolean {
  return !/^(postgres|postgresql|mysql|mysql2):\/\//.test(raw);
}

/** The filesystem path inside a SQLite URL, with any scheme prefix removed. */
export function sqlitePathFromUrl(raw: string): string {
  if (raw.startsWith("sqlite://")) return raw.slice("sqlite://".length);
  if (raw.startsWith("sqlite:")) return raw.slice("sqlite:".length);
  if (raw.startsWith("file:")) return raw.slice("file:".length);
  return raw;
}

/** User tables in an open database — `sqlite_%` internals excluded. */
function userTables(database: Database): string[] {
  const rows = database
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all();
  return rows.map((r) => r.name);
}

/**
 * Open a snapshot and satisfy yourself that it is a database.
 *
 * `PRAGMA integrity_check` is the whole point: it walks every page and every
 * index and reports the single row `ok` when the file is sound. Anything else is
 * a corrupt snapshot, and finding that out now — while the source database is
 * still there — is the difference between a bad night and a lost business.
 *
 * @throws {@link BackupError} When the file will not open, fails its integrity
 *   check, or is missing rows the caller said it must have.
 */
export function verifySnapshot(
  path: string,
  requireRows: string[] = [],
): { tables: string[]; rows: Record<string, number> } {
  let database: Database;
  try {
    database = new Database(path, { readonly: true });
  } catch (error) {
    throw new BackupError(
      `The snapshot at ${path} will not open as a database: ${(error as Error).message}`,
    );
  }

  try {
    // The open above proves nothing — bun:sqlite defers the real work to the first
    // statement, so a text file masquerading as a database opens cleanly and fails
    // here instead. The driver's own error is the honest one; it is wrapped so
    // every failure out of this module is a BackupError a caller can match on.
    let integrity: string[];
    try {
      integrity = database
        .query<{ integrity_check: string }, []>(`PRAGMA integrity_check`)
        .all()
        .map((r) => r.integrity_check);
    } catch (error) {
      throw new BackupError(
        `The snapshot at ${path} is not a readable database: ${(error as Error).message}`,
      );
    }
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      throw new BackupError(
        `The snapshot at ${path} failed its integrity check: ${integrity.join("; ")}`,
      );
    }

    const tables = userTables(database);
    const rows: Record<string, number> = {};
    for (const table of requireRows) {
      if (!tables.includes(table)) {
        throw new BackupError(
          `The snapshot at ${path} has no \`${table}\` table, and --require-rows said it must.`,
        );
      }
      // The table name came from an operator's own flag, not from a request, and
      // it has just been checked against the snapshot's own schema.
      const count =
        database.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${table}"`).get()?.n ?? 0;
      if (count === 0) {
        throw new BackupError(
          `The snapshot at ${path} has an empty \`${table}\` table. A backup of a live ` +
            `system with nothing in it is the failure, not a small discrepancy.`,
        );
      }
      rows[table] = count;
    }
    return { tables, rows };
  } finally {
    database.close();
  }
}

/**
 * Do the restore. Copy the snapshot the way an incident would, open the copy, and
 * check it there.
 *
 * Reading the snapshot in place proves the file is sound. This proves the thing
 * you will actually be asked to do with it works — and it costs one file copy.
 *
 * @throws {@link BackupError} When the restored copy will not open or does not check out.
 */
export function rehearseRestore(path: string, requireRows: string[] = []): void {
  const scratch = `${path}.rehearsal`;
  try {
    copyFileSync(path, scratch);
    verifySnapshot(scratch, requireRows);
  } catch (error) {
    if (error instanceof BackupError) {
      throw new BackupError(`Restore rehearsal failed. ${error.message}`);
    }
    throw new BackupError(`Restore rehearsal failed: ${(error as Error).message}`);
  } finally {
    rmSync(scratch, { force: true });
  }
}

/**
 * Delete snapshots beyond the newest `keep`.
 *
 * Only files matching the name this module writes are considered, so a retention
 * setting can never reach anything a person put in the directory by hand. Names
 * carry a sortable UTC stamp, which is why this can order them without opening one.
 *
 * @returns The filenames deleted.
 */
export function pruneSnapshots(dir: string, keep: number): string[] {
  if (keep <= 0) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const snapshots = entries.filter((name) => SNAPSHOT_PATTERN.test(name)).sort();
  const doomed = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const name of doomed) rmSync(join(dir, name), { force: true });
  return doomed;
}

/**
 * Take a verified snapshot of a live SQLite database.
 *
 * @param run - Runs one statement against the live connection. Injected rather
 *   than imported so this module stays testable without a booted application.
 * @param options - Where the database is, where the snapshot goes, and what must
 *   be true of it before this returns.
 * @throws {@link BackupError} When anything at all goes wrong. There is no path
 *   through this function that reports success without a checked file on disk.
 */
export async function takeBackup(
  run: (sql: string) => Promise<unknown>,
  options: BackupOptions,
): Promise<BackupResult> {
  const { source, dir, keep } = options;
  const requireRows = options.requireRows ?? [];

  if (source === ":memory:" || source === "") {
    throw new BackupError(
      "This app's database is in memory, so there is nothing on disk to back up. " +
        "Point `database.url` at a file first.",
    );
  }
  if (!isSqliteUrl(source)) {
    throw new BackupError(
      `db:backup takes SQLite snapshots, and this app is on ${source.split("://")[0]}. ` +
        `Use that server's own tool — pg_dump or mysqldump — and keep its output somewhere ` +
        `this command is not responsible for.`,
    );
  }

  const path = sqlitePathFromUrl(source);
  try {
    statSync(path);
  } catch {
    throw new BackupError(`There is no database at ${path} to back up.`);
  }

  mkdirSync(dir, { recursive: true });
  const target = join(dir, snapshotName(path, options.now ?? new Date()));

  // Never write over a snapshot. Two runs inside the same second is the only way
  // to get here, and silently replacing the first one loses a backup to a clock.
  try {
    statSync(target);
    throw new BackupError(
      `${target} already exists. A snapshot is never overwritten — wait a second and run again.`,
    );
  } catch (error) {
    if (error instanceof BackupError) throw error;
  }

  try {
    await run(`VACUUM INTO ${sqlLiteral(target)}`);
  } catch (error) {
    throw new BackupError(
      `VACUUM INTO failed, so no snapshot was written: ${(error as Error).message}`,
    );
  }

  let bytes: number;
  try {
    bytes = statSync(target).size;
  } catch {
    throw new BackupError(
      `VACUUM INTO reported success but wrote no file at ${target}. Nothing has been backed up.`,
    );
  }
  if (bytes === 0) {
    rmSync(target, { force: true });
    throw new BackupError(`The snapshot at ${target} was empty, and has been removed.`);
  }

  // A snapshot that fails its checks does not get to stay. Left on disk it is
  // indistinguishable from a good one — and it is the *newest*, so the next run's
  // retention would prune a verified older snapshot to make room for it. The
  // directory must contain only files that passed.
  let tables: string[];
  let rows: Record<string, number>;
  const rehearsed = options.rehearse === true;
  try {
    ({ tables, rows } = verifySnapshot(target, requireRows));
    if (rehearsed) rehearseRestore(target, requireRows);
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }

  // Retention runs last, and only after the new snapshot has checked out. Pruning
  // first would mean a failed backup that also deleted the oldest good one.
  const pruned = pruneSnapshots(dir, keep);

  return { path: target, bytes, tables, rows, pruned, rehearsed };
}
