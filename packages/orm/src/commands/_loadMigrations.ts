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
    records.push({ name: _migrationName(file), instance: new Ctor() });
  }

  return records;
}

/**
 * The identity a migration is recorded under: its bare filename, no directory, no
 * extension, no platform in it.
 *
 * `Bun.Glob` yields native separators, so on Windows this receives
 * `database\migrations\010_x.ts`. The prefix used to be stripped with a
 * forward-slash-only pattern, which matched nothing there — and the value written
 * into the `migrations` table was the whole joined path, backslashes and all.
 *
 * Two ways that hurts, and the second is the dangerous one:
 *
 * - **A database moved between platforms re-runs every migration.** Every recorded
 *   name misses, all of them look pending, and the first one fails on `table
 *   already exists`. That is a failed boot rather than a graceful skip.
 * - **The recorded name is compared against the file's**, so anything that changes
 *   the string makes a migration look unrun. An app renumbered `001_` to `0001_` to
 *   match this framework's own scaffold convention and nearly took an outage: nine
 *   applied migrations would have looked pending. Normalising the separator does not
 *   fix that half — a rename is still a new identity — but it stops the *platform*
 *   from being part of the string, which is the half nobody can see coming.
 *
 * @param file - Path as the glob yielded it, relative to the project root.
 * @returns The bare migration name.
 * @internal
 */
export function _migrationName(file: string): string {
  const normalised = file.split("\\").join("/");
  return (normalised.split("/").at(-1) ?? normalised).replace(/\.[cm]?[jt]s$/, "");
}
