import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadMigrations } from "./_loadMigrations.ts";
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
