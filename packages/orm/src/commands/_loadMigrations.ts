import type { MigrationRecord } from "../schema/MigrationRunner.ts";

/**
 * Globs `database/migrations/*.ts`, imports each file, and returns a
 * {@link MigrationRecord} array of instantiated migrations. Files are sorted by
 * filename so `001_` runs before `002_`; files without a default export are
 * skipped.
 *
 * Shared by the `migrate`, `migrate:fresh`, `migrate:rollback`, and
 * `migrate:status` commands.
 *
 * @internal
 */
export async function loadMigrations(): Promise<MigrationRecord[]> {
  const glob = new Bun.Glob("database/migrations/*.ts");
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: process.cwd() })) {
    files.push(file);
  }

  files.sort();

  const records: MigrationRecord[] = [];
  for (const file of files) {
    const mod = await import(`${process.cwd()}/${file}`);
    const Ctor = mod.default as (new () => MigrationRecord["instance"]) | undefined;
    if (!Ctor) continue;
    const name = file.replace(/^database\/migrations\//, "").replace(/\.ts$/, "");
    records.push({ name, instance: new Ctor() });
  }

  return records;
}
