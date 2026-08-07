/**
 * @zerotal/testing/preload — auto-wires the DB connection for every test worker.
 *
 * Loaded via `bun test --preload @zerotal/testing/preload` when you run
 * `bun zt test`. Reads ZT_DB_URL from the environment (set by
 * TestCommand) and calls _setBaseModelConnection + _setDbConnection so that
 * withDatabase() and DB.table() work without any manual beforeAll setup.
 *
 * Each Bun test worker runs its own copy of this module, so connections are
 * isolated per file — no cross-file leakage.
 */

import { SQL } from "bun";
import { _setBaseModelConnection, _setBaseModelDialect, _setDbConnection } from "@zerotal/orm";

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
