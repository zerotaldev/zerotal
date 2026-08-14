/**
 * Two names that read as the obvious ones but did not exist.
 *
 * `Schema.alter` is what most schema builders call this, and `table.datetime` matches the
 * lowercase column *type* string (`type: "datetime"`) while the builder method is
 * camelCase. Neither was a type error — the blueprint callback is loosely typed — so both
 * failed as a `TypeError` at run time, *after* any earlier statements in the same
 * migration had already executed. A migration that half-runs is worse than one that never
 * starts, so these are aliases now.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { Schema } from "./Schema.ts";
import { Blueprint } from "./Blueprint.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection } from "../index.ts";

beforeAll(async () => {
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  await DB.raw(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`);
});

describe("Schema.alter", () => {
  it("exists and modifies the table like Schema.table", async () => {
    await Schema.alter("users", (t) => {
      t.dateTime("suspended_at").nullable();
    });

    expect(await Schema.hasColumn("users", "suspended_at")).toBe(true);
  });
});

describe("Blueprint.datetime", () => {
  it("is accepted alongside dateTime", () => {
    const lower = new Blueprint();
    lower.datetime("a");
    const camel = new Blueprint();
    camel.dateTime("a");

    // Same column definition either way.
    expect(lower.toCreateSQL("t", "sqlite")).toEqual(camel.toCreateSQL("t", "sqlite"));
  });

  it("works through a real alter", async () => {
    await Schema.alter("users", (t) => {
      t.datetime("verified_at").nullable();
    });

    expect(await Schema.hasColumn("users", "verified_at")).toBe(true);
  });
});
