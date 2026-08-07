#!/usr/bin/env bun
/**
 * Snapshot the site database to `storage/backups/`.
 *
 * Posts written at /admin live only in this file — the committed `blog/*.md`
 * set is the origin of the imported posts, not a copy of anything written
 * since. Losing the volume loses every post authored in the browser, so this
 * exists to be run on a schedule (cron, a platform job, a pre-deploy step).
 *
 * `VACUUM INTO` rather than a file copy: it takes a consistent snapshot of a
 * database that is being written to, which `cp` does not — copying mid-write
 * yields a torn file that may not open. It also compacts as it goes.
 *
 *   bun run db:backup                  # storage/backups/db-<timestamp>.sqlite
 *   bun run db:backup --keep 30        # prune to the newest 30
 */
import { Database } from "bun:sqlite";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const DB_PATH = resolve(process.env["DATABASE_URL"] ?? "./database/db.sqlite");
const BACKUP_DIR = resolve("./storage/backups");

/** `--keep N`, or 14 — enough to notice a bad deploy and roll back. */
function keepCount(): number {
  const index = process.argv.indexOf("--keep");
  if (index === -1) return 14;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 14;
}

if (!(await Bun.file(DB_PATH).exists())) {
  console.error(`No database at ${DB_PATH} — nothing to back up.`);
  process.exit(1);
}

await mkdir(BACKUP_DIR, { recursive: true });

// Colons are legal in a POSIX filename and illegal on Windows; the timestamp is
// written without them so a backup taken on one platform is readable on both.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
const target = join(BACKUP_DIR, `db-${stamp}.sqlite`);

const db = new Database(DB_PATH, { readonly: true });
try {
  // Bound as a parameter: the path comes from a timestamp here, but VACUUM INTO
  // takes a string literal and this keeps it from ever being concatenated.
  db.query("VACUUM INTO ?").run(target);
} finally {
  db.close();
}

const size = (await Bun.file(target).size) / 1024;
console.log(`Backed up → ${target} (${size.toFixed(1)} KB)`);

// Prune oldest-first; names sort chronologically because the stamp is ISO.
const keep = keepCount();
const existing = (await readdir(BACKUP_DIR))
  .filter((name) => name.startsWith("db-") && name.endsWith(".sqlite"))
  .sort();

const stale = existing.slice(0, Math.max(0, existing.length - keep));
for (const name of stale) await unlink(join(BACKUP_DIR, name));
if (stale.length > 0) console.log(`Pruned ${stale.length} older backup(s), keeping ${keep}.`);
