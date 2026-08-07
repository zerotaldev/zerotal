import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import {
  _setBaseModelConnection,
  _setDbConnection,
  _getDbConnectionOverride,
  currentOrmContext,
  type SQLInstance,
} from "@zerotal/orm";
import { migrateDatabase } from "./migrateDatabase.ts";

const FIXTURES = `${import.meta.dir}/__fixtures__/migrations`;

let db: SQLInstance;

beforeEach(() => {
  db = new SQL(":memory:") as unknown as SQLInstance;
});

afterEach(async () => {
  _setBaseModelConnection(null);
  _setDbConnection(null);
  await (db as unknown as { end(): Promise<void> }).end();
});

describe("migrateDatabase()", () => {
  it("builds the schema from the project's own migration files", async () => {
    const ran = await migrateDatabase({ connection: db, path: FIXTURES });

    expect(ran).toEqual(["001_create_widgets_table", "002_create_gadgets_table"]);

    const conn = db as unknown as (
      s: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<Array<{ name: string }>>;
    const tables = await conn`SELECT name FROM sqlite_master WHERE type = 'table'`;
    const names = tables.map((t) => t.name);
    expect(names).toContain("widgets");
    expect(names).toContain("gadgets");
  });

  it("is idempotent — a second run applies nothing", async () => {
    await migrateDatabase({ connection: db, path: FIXTURES });
    const second = await migrateDatabase({ connection: db, path: FIXTURES });

    expect(second).toEqual([]);
  });

  it("migrates the active model connection when none is given", async () => {
    _setBaseModelConnection(db);

    const ran = await migrateDatabase({ path: FIXTURES });

    expect(ran).toHaveLength(2);
  });

  it("restores both connection slots exactly as it found them", async () => {
    // A helper that leaves its own connection pinned behind it detaches every
    // later test from whatever the container resolves.
    expect(_getDbConnectionOverride()).toBeNull();
    expect(currentOrmContext().overrideConnection).toBeNull();

    await migrateDatabase({ connection: db, path: FIXTURES });

    expect(_getDbConnectionOverride()).toBeNull();
    expect(currentOrmContext().overrideConnection).toBeNull();
  });

  it("restores a pre-existing override rather than clearing it", async () => {
    const other = new SQL(":memory:") as unknown as SQLInstance;
    _setDbConnection(other);
    _setBaseModelConnection(other);

    await migrateDatabase({ connection: db, path: FIXTURES });

    expect(_getDbConnectionOverride()).toBe(other);
    expect(currentOrmContext().overrideConnection).toBe(other);

    await (other as unknown as { end(): Promise<void> }).end();
  });

  it("honours a custom tracking table", async () => {
    await migrateDatabase({ connection: db, path: FIXTURES, table: "schema_history" });

    const conn = db as unknown as (
      s: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<Array<{ migration: string }>>;
    const rows = await conn`SELECT migration FROM schema_history`;
    expect(rows).toHaveLength(2);
  });
});
