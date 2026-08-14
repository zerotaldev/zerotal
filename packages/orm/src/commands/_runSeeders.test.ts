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
