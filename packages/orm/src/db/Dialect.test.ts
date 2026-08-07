import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import {
  QueryBuilder,
  dialectFor,
  registerConnectionDialect,
  _setQueryBuilderDialect,
} from "./QueryBuilder.ts";
import {
  BaseModel,
  _setBaseModelConnection,
  _setBaseModelDialect,
  _clearModelConnections,
} from "../model/BaseModel.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";
import { getDialect } from "./dialects/index.ts";
import { Blueprint } from "../schema/Blueprint.ts";

describe("dialectFor() — per-connection registry", () => {
  it("resolves each connection to its registered dialect", () => {
    const a = {} as object;
    const b = {} as object;
    registerConnectionDialect(a, "postgres");
    registerConnectionDialect(b, "mysql");
    expect(dialectFor(a)).toBe("postgres");
    expect(dialectFor(b)).toBe("mysql");
  });
  it("falls back to the global default for unregistered connections", () => {
    _setQueryBuilderDialect("sqlite");
    expect(dialectFor({} as object)).toBe("sqlite");
    expect(dialectFor(undefined)).toBe("sqlite");
  });
});

describe("QueryBuilder — per-connection lock SQL", () => {
  it("emits FOR SHARE on a postgres connection but nothing on sqlite", () => {
    const pg = {} as object;
    registerConnectionDialect(pg, "postgres");
    const lite = {} as object;
    const pgSql = new QueryBuilder("t", pg as never).sharedLock().toSql();
    const liteSql = new QueryBuilder("t", lite as never).sharedLock().toSql();
    expect(pgSql).toContain("FOR SHARE");
    expect(liteSql).not.toContain("FOR SHARE");
  });
  it("uses RAND() on mysql and RANDOM() elsewhere", () => {
    const my = {} as object;
    registerConnectionDialect(my, "mysql");
    expect(new QueryBuilder("t", my as never).inRandomOrder().toSql()).toContain("RAND()");
    expect(new QueryBuilder("t", {} as never).inRandomOrder().toSql()).toContain("RANDOM()");
  });
});

const MYSQL_FMT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_FMT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let liteDb: SQLInstance;
let myDb: SQLInstance;

@table("def_rows")
class DefaultRow extends BaseModel {
  @column({ type: "string" }) name!: string;
}
@table("my_rows")
class MysqlRow extends BaseModel {
  static override connection = "mysqlish";
  @column({ type: "string" }) name!: string;
}

beforeAll(async () => {
  liteDb = new SQL(":memory:");
  myDb = new SQL(":memory:");
  _setBaseModelDialect("sqlite");
  _setBaseModelConnection(liteDb);
  BaseModel.registerConnection("mysqlish", myDb, "mysql");
  await liteDb`CREATE TABLE def_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await myDb`CREATE TABLE my_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  _clearModelConnections();
  await liteDb.end();
  await myDb.end();
});

describe("per-connection date serialisation", () => {
  it("serialises timestamps in MySQL format on the mysql-declared connection", async () => {
    await MysqlRow.bulkInsert([{ name: "x" }]);
    const [row] = await myDb`SELECT created_at FROM my_rows`;
    expect(String(row.created_at)).toMatch(MYSQL_FMT);
  });
  it("serialises timestamps in ISO format on the default sqlite connection", async () => {
    await DefaultRow.bulkInsert([{ name: "y" }]);
    const [row] = await liteDb`SELECT created_at FROM def_rows`;
    expect(String(row.created_at)).toMatch(ISO_FMT);
  });
});

describe("auto-increment is dialect-specific", () => {
  it("emits the form each engine actually accepts", () => {
    // The SQLite spelling was hard-coded, so the very first `migrate` against PostgreSQL
    // died on a syntax error and MySQL on a 1064 — before any application migration ran.
    expect(getDialect("sqlite").autoIncrementColumn("id")).toBe(
      "id INTEGER PRIMARY KEY AUTOINCREMENT",
    );
    expect(getDialect("postgres").autoIncrementColumn("id")).toContain("IDENTITY");
    expect(getDialect("postgres").autoIncrementColumn("id")).not.toContain("AUTOINCREMENT");
    expect(getDialect("mysql").autoIncrementColumn("id")).toContain("AUTO_INCREMENT");
    expect(getDialect("mysql").autoIncrementColumn("id")).not.toContain("AUTOINCREMENT ");
  });

  it("is what Blueprint emits for increments()", () => {
    const pg = new Blueprint();
    pg.increments("id");
    pg.string("name");
    const [create] = pg.toCreateSQL("users", "postgres");
    expect(create).toContain("IDENTITY");
    expect(create).not.toContain("AUTOINCREMENT");
    expect(create).toContain("name TEXT");
  });
});
