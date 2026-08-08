/**
 * A `Date` compared against a timestamp column used to match nothing.
 *
 * Timestamps are stored as ISO strings, and `_coerceWhereValue` serialises a bound value
 * through the column's cast metadata — but the framework-managed `created_at` /
 * `updated_at` / `deleted_at` carry no `@column` registration, so there was no metadata
 * to find and the `Date` object was bound raw. `where("created_at", ">=", monthStart)` is
 * the commonest reporting query there is, and it silently returned zero rows: a dashboard
 * reading "0 enquiries this month" looks like a quiet month rather than a broken query.
 *
 * Declared columns already worked, which is why this survived — the failure was specific
 * to the columns nobody declares.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection, _setBaseModelConnection } from "../index.ts";

@table("enquiries")
class Enquiry extends BaseModel {
  @column() label!: string;
  @column({ type: "datetime", cast: "datetime" }) startedAt!: unknown;
}

const CUTOFF = new Date("2026-08-01T00:00:00.000Z");

beforeAll(async () => {
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  _setBaseModelConnection(conn as never);
  await DB.raw(`CREATE TABLE enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT,
    started_at TEXT, created_at TEXT, updated_at TEXT)`);
  await DB.raw(`INSERT INTO enquiries (label, started_at, created_at, updated_at) VALUES
    ('inside', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z'),
    ('before', '2026-07-05T10:00:00.000Z', '2026-07-05T10:00:00.000Z', '2026-07-05T10:00:00.000Z')`);
});

describe("a Date bound into a comparison", () => {
  it("matches on the auto-managed created_at (snake_case)", async () => {
    expect(await Enquiry.query().where("created_at", ">=", CUTOFF).count()).toBe(1);
  });

  it("matches on the auto-managed timestamp by property name too", async () => {
    expect(await Enquiry.query().where("createdAt", ">=", CUTOFF).count()).toBe(1);
  });

  it("still matches on a declared datetime column", async () => {
    expect(await Enquiry.query().where("startedAt", ">=", CUTOFF).count()).toBe(1);
    expect(await Enquiry.query().where("started_at", ">=", CUTOFF).count()).toBe(1);
  });

  it("agrees with the equivalent ISO-string query", async () => {
    const viaDate = await Enquiry.query().where("created_at", ">=", CUTOFF).count();
    const viaString = await Enquiry.query().where("created_at", ">=", CUTOFF.toISOString()).count();

    expect(viaDate).toBe(viaString);
  });

  it("excludes rows outside the range rather than matching everything", async () => {
    expect(await Enquiry.query().where("created_at", "<", CUTOFF).count()).toBe(1);
  });
});
