import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSeeders } from "./_runSeeders.ts";
import { MigrateFreshCommand } from "./MigrateFreshCommand.ts";
import { MigrateCommand } from "./MigrateCommand.ts";

let root = "";

/**
 * Each case gets its own directory. Seeder modules are imported by absolute
 * path and the module registry caches them, so reusing one path across tests
 * would silently run the first test's seeder in the second.
 */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zt-seed-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSeeder(contents: string, file = "DatabaseSeeder.ts"): void {
  mkdirSync(join(root, "database", "seeders"), { recursive: true });
  writeFileSync(join(root, "database", "seeders", file), contents);
}

describe("runSeeders()", () => {
  it("runs a class-based DatabaseSeeder and reports success", async () => {
    writeSeeder(`
      import { writeFileSync } from "node:fs";
      export class DatabaseSeeder {
        async run() { writeFileSync(${JSON.stringify(join(root, "ran.txt"))}, "yes"); }
      }
    `);

    expect(await runSeeders(root)).toEqual({ status: "seeded" });
    expect(await Bun.file(join(root, "ran.txt")).text()).toBe("yes");
  });

  it("accepts a default export as well as the named one", async () => {
    writeSeeder(`export default class { async run() {} }`);
    expect(await runSeeders(root)).toEqual({ status: "seeded" });
  });

  it("reports the path it looked for when no seeder exists", async () => {
    const outcome = await runSeeders(root);
    expect(outcome.status).toBe("missing");
    // The reported path is what the error message tells the user to create.
    expect(outcome).toMatchObject({ path: `${root}/database/seeders/DatabaseSeeder.ts` });
  });

  it("falls back to a legacy index.ts default function", async () => {
    writeSeeder(
      `import { writeFileSync } from "node:fs";
       export default async function () { writeFileSync(${JSON.stringify(join(root, "legacy.txt"))}, "1"); }`,
      "index.ts",
    );

    expect(await runSeeders(root)).toEqual({ status: "seeded" });
    expect(await Bun.file(join(root, "legacy.txt")).exists()).toBe(true);
  });

  it("reports an invalid legacy seeder rather than throwing", async () => {
    writeSeeder(`export const notDefault = 1;`, "index.ts");
    const outcome = await runSeeders(root);
    expect(outcome.status).toBe("invalid");
  });

  it("reports a seeder that throws, with its message", async () => {
    writeSeeder(`export class DatabaseSeeder { async run() { throw new Error("bad fixture"); } }`);

    const outcome = await runSeeders(root);
    expect(outcome.status).toBe("failed");
    expect(outcome).toMatchObject({ message: "bad fixture" });
  });

  it("reports a seeder module that fails to import", async () => {
    writeSeeder(`this is not valid typescript at all (((`);
    expect((await runSeeders(root)).status).toBe("failed");
  });
});

describe("--seed flag wiring", () => {
  it("migrate:fresh declares --seed, defaulting to off", () => {
    const seed = MigrateFreshCommand.flags.find((f) => f.name === "seed");
    expect(seed).toBeDefined();
    expect(seed!.type).toBe("boolean");
    // Off by default: `migrate:fresh` must not start writing rows to a database
    // for anyone who did not ask it to.
    expect(seed!.default).toBe(false);
  });

  it("migrate declares --seed alongside --fresh", () => {
    // `migrate --fresh` is a synonym for `migrate:fresh`, so --seed has to exist
    // on both or the two paths disagree.
    expect(MigrateCommand.flags.map((f) => f.name)).toEqual(["fresh", "seed"]);
    expect(MigrateCommand.flags.find((f) => f.name === "seed")!.default).toBe(false);
  });
});

/**
 * A seeder that fails partway must leave nothing behind.
 *
 * `Seeder.call()` has always wrapped composed seeders in a transaction, but the
 * top-level `DatabaseSeeder.run()` was invoked bare — and a seeder that does its
 * work inline rather than delegating (which is most of them, including this
 * repo's own cookbook seeders) got no atomicity at all. A failure halfway left
 * its rows committed, so the obvious next move — run it again — died on a unique
 * constraint, and the only recovery was `migrate:fresh`.
 *
 * Migrations gained transactional DDL in 1.7.0; this closes the asymmetry.
 */

/** Absolute path to the ORM's DB module — the temp-dir seeders import it by path. */
const DB_MODULE = new URL("../db/DB.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("runSeeders() atomicity", () => {
  it("rolls back rows written before a seeder throws", async () => {
    const { SQL } = await import("bun");
    const { _setDbConnection } = await import("../db/DB.ts");

    // In-memory, and the connection is set here rather than inside the seeder:
    // a `:memory:` database lives and dies with its connection, so the seeder
    // and this assertion have to be looking at the same one.
    const db = new SQL(":memory:");
    _setDbConnection(db);
    await db`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`;

    writeSeeder(`
      import { DB } from ${JSON.stringify(DB_MODULE)};
      export class DatabaseSeeder {
        async run() {
          await DB.raw("INSERT INTO people (name) VALUES ('ada')");
          // Fails after a successful write — the shape of a real seeder that
          // trips a constraint or a typo on its fourth table.
          throw new Error("seeder blew up");
        }
      }
    `);

    try {
      const outcome = await runSeeders(root);
      expect(outcome.status).toBe("failed");

      const rows = (await db`SELECT name FROM people`) as { name: string }[];
      // The row written before the throw must be gone. Without the surrounding
      // transaction it is still there, and re-running the seeder then dies on
      // the unique index — recovery being `migrate:fresh`.
      expect(rows).toEqual([]);
    } finally {
      _setDbConnection(null);
      await db.end();
    }
  });

  it("commits everything when the seeder succeeds", async () => {
    const { SQL } = await import("bun");
    const { _setDbConnection } = await import("../db/DB.ts");

    const db = new SQL(":memory:");
    _setDbConnection(db);
    await db`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`;

    writeSeeder(`
      import { DB } from ${JSON.stringify(DB_MODULE)};
      export class DatabaseSeeder {
        async run() {
          await DB.raw("INSERT INTO people (name) VALUES ('ada')");
          await DB.raw("INSERT INTO people (name) VALUES ('grace')");
        }
      }
    `);

    try {
      expect(await runSeeders(root)).toEqual({ status: "seeded" });
      const rows = (await db`SELECT name FROM people ORDER BY name`) as { name: string }[];
      expect(rows.map((r) => r.name)).toEqual(["ada", "grace"]);
    } finally {
      _setDbConnection(null);
      await db.end();
    }
  });
});
