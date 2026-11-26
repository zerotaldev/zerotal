import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import type { Application } from "@zerotal/core";
import { _setDbConnection } from "../db/DB.ts";
import { migrationNumbersCheck } from "./migrationNumbersCheck.ts";

const MIGRATION = "export default class { async up() {} async down() {} }\n";
const app = {} as Application;

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zt-migration-numbers-"));
  cwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  _setDbConnection(null);
  rmSync(dir, { recursive: true, force: true });
});

function migrations(...names: string[]): void {
  mkdirSync(join(dir, "database/migrations"), { recursive: true });
  for (const name of names)
    writeFileSync(join(dir, "database/migrations", `${name}.ts`), MIGRATION);
}

describe("migrationNumbersCheck", () => {
  it("is ok with no migrations directory", async () => {
    expect((await migrationNumbersCheck.run(app)).status).toBe("ok");
  });

  it("is ok when every number is unique", async () => {
    migrations("0001_a", "0002_b");
    const result = await migrationNumbersCheck.run(app);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("every number unique");
  });

  it("fails on a clash when there is no database to say it already ran", async () => {
    migrations("0041_a", "0042_add_invoices", "0042_add_refunds");
    const result = await migrationNumbersCheck.run(app);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("0042_add_invoices.ts, 0042_add_refunds.ts");
    expect(result.message).toContain("0043_add_refunds.ts");
  });

  it("warns, not fails, when every clashing migration has already run", async () => {
    migrations("0042_add_invoices", "0042_add_refunds");
    const db = new SQL(":memory:");
    _setDbConnection(db);
    await db`CREATE TABLE migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, migration TEXT NOT NULL UNIQUE, batch INTEGER NOT NULL, ran_at TEXT NOT NULL)`;
    await db`INSERT INTO migrations (migration, batch, ran_at) VALUES ('0042_add_invoices', 1, 'x'), ('0042_add_refunds', 1, 'x')`;
    const result = await migrationNumbersCheck.run(app);
    expect(result.status).toBe("warn");
    await db.end();
  });
});
