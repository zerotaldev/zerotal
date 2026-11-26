/**
 * Two different migrations under one number.
 *
 * Migration files are numbered `0042_add_x`, and the number is how a reader — and
 * `make:migration` — knows what comes next. Two branches cut from the same main each
 * add the next number, both merge, and the app now has `0042_add_invoices` and
 * `0042_add_refunds`. Nothing breaks on the day: the files sort by their suffix, the
 * runner records each under its own name. The damage is to the one thing the number
 * exists for, the order. Which of the two runs first now depends on the alphabet,
 * a database that applied one of them on a branch has a different history from one
 * that applied both on main, and the next `make:migration` picks `0043` on top of an
 * ambiguity nobody chose.
 *
 * Production apps reported checking the highest number on main by hand before every
 * migration they wrote. This module is the check they were doing.
 *
 * @module
 */

/** A migration file's ordinal and the files that share it. */
export interface _MigrationNumberClash {
  /** The number as the first of the files spells it, e.g. `0042`. */
  number: string;
  /** Bare filenames (no directory, no extension), in sort order. */
  files: string[];
}

/**
 * The ordinal a migration filename starts with, or `undefined` when it has none.
 *
 * Two shapes are read: a plain sequence number (`0042_add_x`, `42-add-x`) and a
 * `YYYY_MM_DD_HHMMSS_` timestamp, whose first group alone would make every migration
 * written in one year share the number `2024`. The key compares by value, so `042`
 * and `0042` are the same number.
 *
 * @internal
 */
export function _migrationOrdinal(name: string): { key: string; spelled: string } | undefined {
  const match = /^(\d{4}_\d{2}_\d{2}_\d{6}|\d+)(?=[_-]|$)/.exec(name);
  if (!match) return undefined;
  const spelled = match[1]!;
  const key = spelled.includes("_") ? spelled : spelled.replace(/^0+(?=\d)/, "");
  return { key, spelled };
}

/**
 * Every number that more than one migration file uses.
 *
 * Reads filenames rather than recorded identities on purpose. A migration that pins
 * its identity with `static id` keeps its recorded name when its file is renumbered,
 * which is exactly how an app moves one of two already-applied clashing migrations
 * out of the way without making it look unrun.
 *
 * @param files - Migration filenames or paths, in any order.
 * @returns One entry per shared number, in number order; empty when every number is unique.
 * @internal
 */
export function _migrationNumberClashes(files: readonly string[]): _MigrationNumberClash[] {
  const byKey = new Map<string, { spelled: string; files: string[] }>();
  for (const file of files) {
    const name = _bareMigrationName(file);
    const ordinal = _migrationOrdinal(name);
    if (!ordinal) continue;
    const group = byKey.get(ordinal.key) ?? { spelled: ordinal.spelled, files: [] };
    group.files.push(name);
    byKey.set(ordinal.key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.files.length > 1)
    .map((group) => ({ number: group.spelled, files: [...group.files].sort() }))
    .sort((a, b) => a.files[0]!.localeCompare(b.files[0]!));
}

/**
 * What to tell somebody whose migrations clash, with the fix for each case.
 *
 * @param clashes - From {@link _migrationNumberClashes}.
 * @param next - The next free number, for the rename suggestion.
 * @internal
 */
export function _describeMigrationNumberClashes(
  clashes: readonly _MigrationNumberClash[],
  next: string,
): string {
  const lines = clashes.map(
    (clash) => `  ${clash.number}: ${clash.files.map((f) => `${f}.ts`).join(", ")}`,
  );
  const example = clashes[0]!.files.at(-1)!;
  const renamed = example.replace(/^(\d{4}_\d{2}_\d{2}_\d{6}|\d+)/, next);
  return (
    `Two different migrations share a number, usually because two branches each added ` +
    `"the next one":\n${lines.join("\n")}\n\n` +
    `  Renumber the one that has not reached production to the next free number, e.g.\n` +
    `    database/migrations/${example}.ts → database/migrations/${renamed}.ts\n` +
    `  If it has already run somewhere, keep its recorded identity while renaming:\n` +
    `    static override id = "${example}";`
  );
}

/**
 * The clashes that still matter: those with at least one member not yet applied.
 *
 * A clash whose migrations have all run is history. Both are recorded, and the
 * order they ran in is the order they will always have run in, so refusing to
 * migrate over it would stop a deploy for something no deploy can change. A clash
 * with a pending member is the one about to happen.
 *
 * @param migrations - Each loaded migration's file and recorded identity.
 * @param pending - Identities not yet applied.
 * @internal
 */
export function _unappliedMigrationNumberClashes(
  migrations: ReadonlyArray<{ file?: string | undefined; name: string }>,
  pending: ReadonlySet<string>,
): _MigrationNumberClash[] {
  // A record without a file (one built by hand rather than loaded from disk) is
  // its own filename.
  const files = migrations.map((m) => _bareMigrationName(m.file ?? m.name));
  const identity = new Map(migrations.map((m, i) => [files[i]!, m.name]));
  return _migrationNumberClashes(files).filter((clash) =>
    clash.files.some((file) => pending.has(identity.get(file) ?? file)),
  );
}

/** A path or filename reduced to its bare migration name. */
function _bareMigrationName(file: string): string {
  const normalised = file.split("\\").join("/");
  return (normalised.split("/").at(-1) ?? normalised).replace(/\.[cm]?[jt]s$/, "");
}
