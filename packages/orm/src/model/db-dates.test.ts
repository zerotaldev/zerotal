/**
 * A model reads back the instant it wrote, on a server whose zone is not UTC.
 *
 * The ORM stores every date as UTC. On MySQL it writes `YYYY-MM-DD HH:MM:SS`
 * because `DATETIME` refuses ISO 8601's `T` and `Z` — and that text, with no zone
 * in it, was parsed back as local time. Every MySQL date then moved by the
 * server's offset between save and load, and so did SQLite's own
 * `CURRENT_TIMESTAMP`, which is UTC written the same way. CI runs with `TZ` unset,
 * where local is UTC and nothing moves, so these tests set a zone of their own.
 *
 * Also here: comparisons on MySQL bind a date the way writes store it, a date no
 * `Carbon` can hold fails the same way on every Bun, and a JSON document reads the
 * same whether the driver parsed it (MariaDB on Bun 1.4) or returned it as text.
 */
import { describe, it, expect, afterAll, afterEach } from "bun:test";
import { useProcessZone } from "../__fixtures__/processZone.ts";
import { SQL } from "bun";
import { Carbon } from "@zerotal/core/carbon";
import { BaseModel, _setBaseModelConnection, _setBaseModelDialect } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB, _setDbConnection } from "../db/DB.ts";
import { registerConnectionDialect } from "../db/QueryBuilder.ts";
import { _resetMysqlDateDecoding } from "../db/driverDates.ts";
import type { SQLInstance } from "../db/sql-types.ts";

@table("moments")
class Moment extends BaseModel {
  @column() label!: string;
  @column({ type: "datetime" }) at!: Carbon;
  @column({ type: "datetime", cast: "datetime", nullable: true }) castAt?: Carbon;
  @column({ cast: "immutable_datetime", nullable: true }) fixedAt?: Carbon;
  @column({ cast: "date", nullable: true }) day?: Date;
  @column({ type: "json", nullable: true }) doc?: unknown;
}

const INSTANT = Date.UTC(2026, 7, 20, 3, 0, 0);
/** How the ORM writes that instant on MySQL. */
const MYSQL_TEXT = "2026-08-20 03:00:00";

useProcessZone("America/New_York");

afterAll(() => {
  _resetMysqlDateDecoding();
});

afterEach(() => {
  _setBaseModelDialect("sqlite");
  _setBaseModelConnection(null);
  _setDbConnection(null);
});

describe("hydrating a zone-less stored date", () => {
  it("reads every kind of date column as UTC", () => {
    const m = Moment.fromRow({
      id: 1,
      label: "x",
      at: MYSQL_TEXT,
      cast_at: MYSQL_TEXT,
      fixed_at: MYSQL_TEXT,
      day: MYSQL_TEXT,
      created_at: MYSQL_TEXT,
      updated_at: MYSQL_TEXT,
    }) as Moment;

    expect(m.at.valueOf()).toBe(INSTANT);
    expect(m.castAt!.valueOf()).toBe(INSTANT);
    expect(m.fixedAt!.valueOf()).toBe(INSTANT);
    expect(m.day!.getTime()).toBe(INSTANT);
    expect(m.createdAt!.valueOf()).toBe(INSTANT);
    expect(m.updatedAt!.valueOf()).toBe(INSTANT);
  });

  it("reads a string that carries its own zone as written", () => {
    const m = Moment.fromRow({ id: 1, at: "2026-08-20T05:00:00+02:00" }) as Moment;
    expect(m.at.valueOf()).toBe(INSTANT);
  });

  it("takes SQLite's CURRENT_TIMESTAMP as the UTC it is", async () => {
    const conn = new SQL(":memory:");
    _setDbConnection(conn as never);
    _setBaseModelConnection(conn as never);
    await DB.raw(`CREATE TABLE moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
    await DB.raw(`INSERT INTO moments (label, at) VALUES ('now', '2026-08-20T03:00:00.000Z')`);

    const m = (await Moment.query().where("label", "now").first())!;
    expect(Math.abs(m.createdAt!.valueOf() - Date.now())).toBeLessThan(60_000);
    await conn.close();
  });
});

describe("a date no Carbon can hold", () => {
  // PostgreSQL `infinity` is an invalid Date on Bun 1.3 and a number on 1.4.
  for (const [what, value] of [
    ["an invalid Date (Bun 1.3)", new Date(NaN)],
    ["Infinity (Bun 1.4)", Infinity],
    ["-Infinity (Bun 1.4)", -Infinity],
  ] as const) {
    it(`fails naming the column for ${what}`, () => {
      expect(() => Moment.fromRow({ id: 1, at: value })).toThrow(RangeError);
      expect(() => Moment.fromRow({ id: 1, at: value })).toThrow(/Moment\.at holds/);
      expect(() => Moment.fromRow({ id: 1, cast_at: value })).toThrow(/Moment\.castAt holds/);
      expect(() => Moment.fromRow({ id: 1, created_at: value })).toThrow(/Moment\.createdAt/);
    });
  }
});

describe("a JSON document", () => {
  // MariaDB 10.5+ JSON columns come back parsed on Bun 1.4 and as text on 1.3.
  for (const doc of [{ a: 1, b: [true, null] }, [1, "two"], 42, true, null]) {
    it(`reads the same parsed or as text: ${JSON.stringify(doc)}`, () => {
      const parsed = Moment.fromRow({ id: 1, doc }) as Moment;
      const text = Moment.fromRow({ id: 1, doc: JSON.stringify(doc) }) as Moment;
      expect(parsed.doc).toEqual(doc);
      expect(text.doc).toEqual(doc);
    });
  }
});

describe("comparing a date on MySQL", () => {
  function captureMysql(): { conn: SQLInstance; bound: unknown[][] } {
    const bound: unknown[][] = [];
    const fn = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      bound.push(values);
      return Promise.resolve([]);
    };
    const conn = Object.assign(fn, {
      begin: () => Promise.reject(new Error("not used")),
      end: () => Promise.resolve(),
    }) as unknown as SQLInstance;
    return { conn, bound };
  }

  it("binds a Carbon the way a save stores it, not as ISO text", async () => {
    const { conn, bound } = captureMysql();
    _setBaseModelConnection(conn);
    _setBaseModelDialect("mysql");
    registerConnectionDialect(conn, "mysql");

    const when = Carbon.create(new Date(INSTANT));
    await Moment.query().where("at", ">=", when).get();
    await Moment.query().where("castAt", ">=", when).get();
    await Moment.query().where("created_at", ">=", when).get();
    await Moment.query().where("created_at", ">=", new Date(INSTANT)).get();

    expect(bound.map((values) => values[0])).toEqual([
      MYSQL_TEXT,
      MYSQL_TEXT,
      MYSQL_TEXT,
      MYSQL_TEXT,
    ]);
  });

  it("still binds ISO 8601 on the other dialects", async () => {
    const { conn, bound } = captureMysql();
    _setBaseModelConnection(conn);
    _setBaseModelDialect("postgres");
    registerConnectionDialect(conn, "postgres");

    await Moment.query()
      .where("castAt", ">=", Carbon.create(new Date(INSTANT)))
      .get();
    expect(bound[0]![0]).toBe(new Date(INSTANT).toISOString());
  });
});
