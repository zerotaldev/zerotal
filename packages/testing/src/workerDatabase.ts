/**
 * One test database per `bun test --parallel` worker.
 *
 * With `--parallel`, Bun runs test files in several processes at once, and tells each its number
 * in `BUN_TEST_WORKER_ID`. An in-memory SQLite database is already private to its process. A SQLite
 * file is not: every worker would open the same file, and one worker's rows, deletions and
 * transactions would land in another's tests. So each worker gets a copy of the file, made when it
 * starts, and uses that instead. The copy starts from whatever the file holds, so a schema built by
 * `zt test --migrate` is in every worker's copy.
 *
 * PostgreSQL and MySQL are left alone: a copy there is a database or a schema of its own, which
 * this does not create. `zt test --parallel` says so when it runs against one.
 *
 * @module
 */
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { extname } from "node:path";

/** Whether a database URL names a server rather than a SQLite file. */
export function _isServerDatabaseUrl(url: string): boolean {
  return /^(postgres|postgresql|mysql|mysql2|mariadb):\/\//.test(url);
}

/**
 * The database a test worker should use: for a SQLite file under `--parallel`, a copy of it of the
 * worker's own; otherwise `url` unchanged.
 *
 * @param url - The test database URL (`ZT_DB_URL`).
 * @param worker - `BUN_TEST_WORKER_ID`, or `undefined` outside `--parallel`.
 * @returns The URL this worker should connect to.
 * @internal
 */
export function _workerDatabaseUrl(
  url: string | undefined,
  worker: string | undefined,
): string | undefined {
  if (!url || !worker || url === ":memory:" || _isServerDatabaseUrl(url)) return url;
  const prefix = ["sqlite://", "sqlite:", "file:"].find((scheme) => url.startsWith(scheme)) ?? "";
  const path = url.slice(prefix.length);
  if (path === ":memory:" || path === "") return url;

  const extension = extname(path);
  const base = extension ? path.slice(0, -extension.length) : path;
  const copy = `${base}.worker-${worker}${extension}`;
  // Fresh on every start, so a worker never inherits rows a previous run left in its copy. On
  // Windows a copy the worker's previous file still holds open cannot be replaced; that worker
  // then keeps the copy it has, as a serial run keeps its one file.
  try {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${copy}${suffix}`, { force: true });
    if (existsSync(path)) copyFileSync(path, copy);
  } catch {
    // Keep the existing copy.
  }
  return `${prefix}${copy}`;
}
