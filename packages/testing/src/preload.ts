/**
 * @zerotal/testing/preload — auto-wires the DB connection for every test worker,
 * and checks the runtime the tests are actually running on.
 *
 * Loaded via `bun test --preload @zerotal/testing/preload` when you run
 * `bun zt test`. Reads ZT_DB_URL from the environment (set by
 * TestCommand) and calls _setBaseModelConnection + _setDbConnection so that
 * withDatabase() and DB.table() work without any manual beforeAll setup.
 *
 * Each Bun test *worker* evaluates this module once — not once per file. Every
 * file that worker runs therefore shares the connection wired here, and shares
 * every other piece of module-level state in the process with it.
 *
 * This used to read "isolated per file — no cross-file leakage", which is the
 * assumption that let five separate cross-file leaks hide: a `document` stub, a
 * runtime-mode variable, an ORM dialect, and two whole booted applications, each
 * set by one file and read by another. Verified rather than assumed — a hook
 * registered here runs once at the end of a run, not once per file.
 *
 * So a test that mutates process-global state has to put it back, and the reason
 * it is easy to skip is that the damage lands somewhere else: the file that
 * breaks is the one that ran next, and which file that is depends on directory
 * order — alphabetical on Windows, arbitrary on Linux.
 *
 * ## Why the runtime check is here and not only in `zt test`
 *
 * `startZerotal()` refuses to run below the project's `engines.bun`, which covers
 * every `zt` command. It does not cover `bun test` typed straight into a shell,
 * and that is the case worth catching: the shell's `bun` and the project's can
 * differ, and the difference shows up as a handful of `Intl` assertions going red
 * with nothing in the failure naming a binary. A parent-process check cannot see
 * this — only an assertion from inside the process the tests run in can, which is
 * what a preload is.
 */

import { SQL } from "bun";
import { _setBaseModelConnection, _setBaseModelDialect, _setDbConnection } from "@zerotal/orm";
import { runtimeBelowFloor, runtimeBelowFloorMessage } from "@zerotal/core/runtime";

// A warning rather than a refusal: a preload that throws takes down the whole run,
// and a suite that is merely *suspect* should still produce its results — the point
// is that the version is named at the top of the output instead of being the last
// thing anyone thinks to check.
const _floor = runtimeBelowFloor();
if (_floor) {
  console.warn(`\n⚠  ${runtimeBelowFloorMessage(_floor)}\n`);
}

const url = Bun.env["ZT_DB_URL"];

if (url && url !== ":memory:") {
  const db = new SQL(url);

  _setBaseModelConnection(db);
  _setDbConnection(db);

  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) {
    _setBaseModelDialect("mysql");
  } else if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    _setBaseModelDialect("postgres");
  }
  // else: sqlite (default)
}
// When ZT_DB_URL is ':memory:', we leave the connections unset so each test
// can create its own in-process SQLite via createTestApp() or withDatabase().
// Bun's global `sql` fallback (which reads DATABASE_URL) is also still active.
