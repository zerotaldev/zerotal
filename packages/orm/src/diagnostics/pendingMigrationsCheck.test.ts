import { describe, expect, it, afterEach } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingMigrationsCheck } from "./pendingMigrationsCheck.ts";
import { _setDbConnection } from "../db/DB.ts";
import type { Application } from "@zerotal/core";

const temporaries: string[] = [];
const originalCwd = process.cwd();

/** A project root with `database/migrations` in it, and the cwd pointed at it. */
function project(migrations: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "zt-pending-"));
  temporaries.push(root);
  mkdirSync(join(root, "database", "migrations"), { recursive: true });
  for (const [name, body] of Object.entries(migrations)) {
    writeFileSync(join(root, "database", "migrations", name), body);
  }
  process.chdir(root);
  return root;
}

/** A migration that creates one table — enough for the runner to load and count. */
function migration(table: string): string {
  return `export default class {
    async up(schema) { await schema.create("${table}", (t) => { t.increments("id"); }); }
    async down(schema) { await schema.drop("${table}"); }
  };\n`;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true, force: true });
  _setDbConnection(null);
});

/** The check takes no app, but the signature does. */
const app = undefined as unknown as Application;

describe("pending-migrations doctor check", () => {
  it("is quiet when there is no migration state to read", async () => {
    // No connection installed: an app with no database is not an app with a
    // migration problem, and saying so on every run would make this the noisiest
    // line in the report.
    project();
    const result = await pendingMigrationsCheck.run(app);
    expect(result.status).toBe("ok");
  });

  it("is quiet when every migration on disk has run", async () => {
    project();
    _setDbConnection(new SQL(":memory:"));
    const result = await pendingMigrationsCheck.run(app);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("has run");
  });

  it("warns — never fails — when migrations are pending", async () => {
    project({
      "001_create_assets.ts": migration("assets"),
      "002_create_posts.ts": migration("posts"),
    });
    _setDbConnection(new SQL(":memory:"));

    const result = await pendingMigrationsCheck.run(app);
    // A warning, not a failure: pending migrations are the normal state of a
    // checkout that just pulled, and a doctor that fails there gets ignored.
    expect(result.status).toBe("warn");
    expect(result.message).toContain("2 migration(s) have not run");
    expect(result.fix).toBe("bun zt migrate");
  });

  it("names them, because '3 pending' only sends you to migrate:status", async () => {
    project({
      "001_create_assets.ts": migration("assets"),
      "002_create_posts.ts": migration("posts"),
    });
    _setDbConnection(new SQL(":memory:"));

    const result = await pendingMigrationsCheck.run(app);
    expect(result.message).toContain("001_create_assets");
    expect(result.message).toContain("002_create_posts");
  });

  it("summarises the tail rather than printing every name", async () => {
    const many: Record<string, string> = {};
    for (let i = 1; i <= 8; i++) {
      many[`00${i}_create_t${i}.ts`] = migration(`t${i}`);
    }
    project(many);
    _setDbConnection(new SQL(":memory:"));

    const result = await pendingMigrationsCheck.run(app);
    expect(result.message).toContain("8 migration(s) have not run");
    expect(result.message).toContain("and 3 more");
  });

  it("says what the failure will look like, since its stack will not", async () => {
    project({ "001_create_assets.ts": migration("assets") });
    _setDbConnection(new SQL(":memory:"));

    const result = await pendingMigrationsCheck.run(app);
    // The whole reason this check is worth having: the error it prevents arrives
    // with a stack of framework frames and names nothing actionable.
    expect(result.message).toContain("no such table");
  });
});
