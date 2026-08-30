import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadMigrations, _migrationName } from "./_loadMigrations.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmpProject(): Promise<string> {
  const dir = join(
    tmpdir(),
    `reno-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, "database", "migrations"), { recursive: true });
  return dir;
}

const MIGRATION_TS = `
export default class TestMigration {
  async up(_ctx: unknown): Promise<void> {}
  async down(_ctx: unknown): Promise<void> {}
}
`;

const NO_DEFAULT_TS = `
// no default export
export const ignored = true;
`;

// ── tests ─────────────────────────────────────────────────────────────────────

describe("loadMigrations", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(async () => {
    origCwd = process.cwd();
    tmpDir = await makeTmpProject();
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty array when no migration files exist", async () => {
    process.chdir(tmpDir);
    const records = await loadMigrations();
    expect(records).toEqual([]);
  });

  it("returns MigrationRecord[] for each valid migration file", async () => {
    const migrationsDir = join(tmpDir, "database", "migrations");
    await writeFile(join(migrationsDir, "001_create_users.ts"), MIGRATION_TS);
    process.chdir(tmpDir);

    const records = await loadMigrations();
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toContain("001_create_users");
    expect(typeof records[0]!.instance.up).toBe("function");
    expect(typeof records[0]!.instance.down).toBe("function");
  });

  it("sorts migration files alphabetically", async () => {
    const migrationsDir = join(tmpDir, "database", "migrations");
    await writeFile(join(migrationsDir, "003_add_indexes.ts"), MIGRATION_TS);
    await writeFile(join(migrationsDir, "001_create_users.ts"), MIGRATION_TS);
    await writeFile(join(migrationsDir, "002_add_posts.ts"), MIGRATION_TS);
    process.chdir(tmpDir);

    const records = await loadMigrations();
    expect(records).toHaveLength(3);
    expect(records[0]!.name).toContain("001_create_users");
    expect(records[1]!.name).toContain("002_add_posts");
    expect(records[2]!.name).toContain("003_add_indexes");
  });

  it("skips files that have no default export", async () => {
    const migrationsDir = join(tmpDir, "database", "migrations");
    await writeFile(join(migrationsDir, "001_valid.ts"), MIGRATION_TS);
    await writeFile(join(migrationsDir, "002_no_default.ts"), NO_DEFAULT_TS);
    process.chdir(tmpDir);

    const records = await loadMigrations();
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toContain("001_valid");
  });
});

/**
 * The recorded name must not carry the platform that recorded it.
 *
 * `Bun.Glob` yields native separators, so on Windows the prefix strip — a
 * forward-slash-only pattern — matched nothing and the whole joined path went into
 * the `migrations` table. An app found `database\migrations\010_add_tenant_limits`
 * in ten dev rows and `010_add_tenant_limits` in production, from the same files.
 *
 * A database moved between the two re-runs every migration: every recorded name
 * misses, all of them look pending, and the first fails on `table already exists`.
 */
describe("_migrationName", () => {
  it("strips a POSIX prefix", () => {
    expect(_migrationName("database/migrations/010_add_tenant_limits.ts")).toBe(
      "010_add_tenant_limits",
    );
  });

  it("strips a Windows prefix to exactly the same string", () => {
    expect(_migrationName("database\\migrations\\010_add_tenant_limits.ts")).toBe(
      "010_add_tenant_limits",
    );
  });

  it("agrees across platforms, which is the whole point", () => {
    expect(_migrationName("database\\migrations\\001_x.ts")).toBe(
      _migrationName("database/migrations/001_x.ts"),
    );
  });

  it("handles a configured directory that is not the default", () => {
    expect(_migrationName("db/schema/0001_init.ts")).toBe("0001_init");
    expect(_migrationName("0001_init.ts")).toBe("0001_init");
  });

  it("drops the extension for every form a migration can ship as", () => {
    expect(_migrationName("database/migrations/001_x.js")).toBe("001_x");
    expect(_migrationName("database/migrations/001_x.mjs")).toBe("001_x");
  });

  it("leaves a dotted name alone apart from its extension", () => {
    expect(_migrationName("database/migrations/2024.01.01_create_users.ts")).toBe(
      "2024.01.01_create_users",
    );
  });
});
