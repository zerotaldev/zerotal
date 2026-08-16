import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { _setDbConnection } from "../db/DB.ts";
import { registerConnectionDialect } from "../db/QueryBuilder.ts";
import { _setQueryBuilderDialect } from "../db/QueryBuilder.ts";
import { Migration } from "./Migration.ts";
import { MigrationRunner } from "./MigrationRunner.ts";
import { Schema } from "./Schema.ts";
import { MigrationError } from "../errors/MigrationError.ts";

/**
 * Which connection each statement actually went to.
 *
 * A real SQLite test cannot answer this. `new SQL(":memory:")` is a single
 * handle — an in-memory database cannot be pooled, because a second connection
 * would open a second, empty database — so the "global" connection and the
 * transaction's connection are the same object, and DDL joins the transaction by
 * accident whether or not the code meant it to.
 *
 * That is exactly how the bug survived: it is invisible on the engine the suite
 * runs against and fatal on the one production uses. PostgreSQL hands
 * `begin(fn)` a *reserved* connection out of a pool, so DDL that resolves the
 * global connection lands somewhere else entirely and commits on its own — while
 * the enclosing `begin()` reports success and its `ROLLBACK` finds nothing to
 * undo.
 *
 * So these tests use a fake that keeps the two distinguishable and records where
 * everything went.
 */

interface Recorded {
  /** "root" for the pooled connection, "tx" for the one `begin()` reserved. */
  on: "root" | "tx";
  sql: string;
}

interface FakeConnection {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<never[]>;
  begin(fn: (tx: FakeConnection) => Promise<unknown>): Promise<unknown>;
  /** Set to make the *next* statement matching this fragment throw. */
  failOn?: string;
}

/** Every statement seen this test, in order, tagged with the connection it used. */
let log: Recorded[] = [];
/** How many transactions were opened. */
let begins = 0;
/** Whether the last transaction committed (vs. rolled back). */
let committed = 0;

/**
 * The tracking table, just real enough for the runner to navigate.
 *
 * The runner reads it to decide what is pending and which batch to roll back, so
 * a fake that answered every SELECT with `[]` would make `rollback()` return
 * early and the test assert nothing.
 */
let rows: Array<{ migration: string; batch: number }> = [];

function makeConnection(): FakeConnection {
  const record = (on: "root" | "tx") => {
    const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?").trim().replace(/\s+/g, " ");
      log.push({ on, sql });
      if (root.failOn && sql.includes(root.failOn)) {
        return Promise.reject(new Error(`fake failure on: ${root.failOn}`));
      }

      if (sql.startsWith("INSERT INTO migrations")) {
        rows.push({ migration: String(values[0]), batch: Number(values[1]) });
        return Promise.resolve([] as never[]);
      }
      if (sql.startsWith("DELETE FROM migrations")) {
        rows = rows.filter((row) => row.migration !== String(values[0]));
        return Promise.resolve([] as never[]);
      }
      if (sql.includes("MAX(batch)")) {
        const max = rows.reduce((highest, row) => Math.max(highest, row.batch), 0);
        return Promise.resolve([{ b: max }] as never[]);
      }
      if (sql.includes("WHERE batch = ")) {
        const batch = Number(values[0]);
        return Promise.resolve(rows.filter((row) => row.batch === batch) as never[]);
      }
      if (sql.startsWith("SELECT migration") || sql.startsWith("SELECT id, migration")) {
        return Promise.resolve(rows as never[]);
      }
      return Promise.resolve([] as never[]);
    }) as FakeConnection;
    return fn;
  };

  const root = record("root");
  const tx = record("tx");

  root.begin = async (fn) => {
    begins++;
    const result = await fn(tx);
    // Only reached when the callback resolved. A throw propagates and leaves
    // `committed` where it was, which is how the tests see a rollback.
    committed++;
    return result;
  };
  // A nested begin on the tx handle would be a savepoint; nothing here needs one.
  tx.begin = root.begin;

  return root;
}

let conn: FakeConnection;
let runner: MigrationRunner;

beforeEach(() => {
  log = [];
  rows = [];
  begins = 0;
  committed = 0;
  conn = makeConnection();
  _setDbConnection(conn as never);
  _setQueryBuilderDialect("postgres");
  registerConnectionDialect(conn, "postgres");
  runner = new MigrationRunner({ connection: conn as never });
});

afterEach(() => {
  _setDbConnection(null);
  _setQueryBuilderDialect("sqlite");
});

class CreatesATable extends Migration {
  async up() {
    await Schema.create("widgets", (table) => table.increments("id"));
  }
  async down() {
    await Schema.dropIfExists("widgets");
  }
}

const entries = () => [{ name: "001_widgets", migration: new CreatesATable() }];
const on = (fragment: string): Recorded[] => log.filter((entry) => entry.sql.includes(fragment));

describe("migration atomicity — where the statements actually go", () => {
  it("runs the migration's DDL on the transaction, not the pool", async () => {
    await runner.run(entries());

    const creates = on("CREATE TABLE widgets");
    expect(creates).toHaveLength(1);
    // The whole bug in one assertion: `Schema` resolved the global connection,
    // so this said "root" and the surrounding transaction governed nothing.
    expect(creates[0]?.on).toBe("tx");
  });

  it("writes the tracking row on the same transaction", async () => {
    await runner.run(entries());

    const inserts = on("INSERT INTO migrations");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.on).toBe("tx");
  });

  it("records the migration inside the transaction, after its DDL", async () => {
    await runner.run(entries());

    const order = log.filter((e) => e.on === "tx").map((e) => e.sql);
    const create = order.findIndex((sql) => sql.includes("CREATE TABLE widgets"));
    const insert = order.findIndex((sql) => sql.includes("INSERT INTO migrations"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(create);
  });

  it("opens exactly one transaction per migration", async () => {
    await runner.run(entries());
    expect(begins).toBe(1);
    expect(committed).toBe(1);
  });

  it("does not commit when the migration fails", async () => {
    conn.failOn = "CREATE TABLE widgets";
    await expect(runner.run(entries())).rejects.toBeInstanceOf(MigrationError);

    expect(begins).toBe(1);
    expect(committed).toBe(0);
    // And nothing claimed it ran — the INSERT never happened, so even a fake
    // that ignored the rollback has no row to show for it.
    expect(on("INSERT INTO migrations")).toHaveLength(0);
  });

  it("runs the rollback's DDL and its DELETE on one transaction", async () => {
    await runner.run(entries());
    log = [];
    begins = 0;

    await runner.rollback(entries());

    const drops = on("DROP TABLE IF EXISTS widgets");
    const deletes = on("DELETE FROM migrations");
    expect(drops[0]?.on).toBe("tx");
    expect(deletes[0]?.on).toBe("tx");
    expect(begins).toBe(1);
  });
});

describe("migration atomicity — engines without transactional DDL", () => {
  beforeEach(() => {
    _setQueryBuilderDialect("mysql");
    registerConnectionDialect(conn, "mysql");
    runner = new MigrationRunner({ connection: conn as never });
  });

  it("reports that a failure will not be rolled back", () => {
    expect(runner.willRollBackOnFailure).toBe(false);
  });

  it("does not open a transaction it cannot honour", async () => {
    await runner.run(entries());

    // MySQL implicitly commits on DDL, so `BEGIN … ROLLBACK` around a migration
    // reports a rollback that did not happen. Not wrapping is the honest
    // behaviour — and it is what `zt migrate` warns about up front.
    expect(begins).toBe(0);
    expect(on("CREATE TABLE widgets")[0]?.on).toBe("root");
    expect(on("INSERT INTO migrations")[0]?.on).toBe("root");
  });

  it("still records the migration and still reports the failure", async () => {
    conn.failOn = "CREATE TABLE widgets";
    await expect(runner.run(entries())).rejects.toBeInstanceOf(MigrationError);
    expect(on("INSERT INTO migrations")).toHaveLength(0);
  });
});
