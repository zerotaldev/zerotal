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

/** A timestamp to the second: two migrations sharing one is a real clash. */
const TIMESTAMP = /^(\d{4}[_-]\d{2}[_-]\d{2}[_-]\d{6}|\d{14})(?=[_-]|$)/;
/** A date alone. Not an ordinal: two migrations written the same day is normal. */
const DATE_ONLY = /^(\d{4}[_-]\d{2}[_-]\d{2}|\d{8})(?=[_-]|$)/;
/** A plain sequence number. */
const SEQUENCE = /^(\d{1,6})(?=[_-]|$)/;

/**
 * The ordinal a migration filename starts with, or `undefined` when it has none.
 *
 * Read as a plain sequence number (`0042_add_x`, `42-add-x`) or a timestamp to the
 * second (`2024_01_15_093000_`, `20240115093000_`). A date with no time
 * (`2024_01_15_`, `2024-01-15-`, `20240115_`) is not an ordinal: files written on
 * one day share it as a matter of course and sort by the rest of their name. Read
 * as a number, it was the year, so every migration in a year "clashed".
 *
 * A letter straight after the number (`0042b_`) makes it no ordinal at all. That is
 * deliberate: it is how an app keeps an already-run clash in its order — see
 * {@link _describeMigrationNumberClashes}.
 *
 * The key compares by value, so `042` and `0042` are the same number.
 *
 * @internal
 */
export function _migrationOrdinal(name: string): { key: string; spelled: string } | undefined {
  const timestamp = TIMESTAMP.exec(name);
  if (timestamp) return { key: timestamp[1]!.replace(/\D/g, ""), spelled: timestamp[1]! };
  if (DATE_ONLY.test(name)) return undefined;
  const sequence = SEQUENCE.exec(name);
  if (!sequence) return undefined;
  const spelled = sequence[1]!;
  return { key: spelled.replace(/^0+(?=\d)/, ""), spelled };
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
  const clash = clashes[0]!;
  const example = clash.files.at(-1)!;
  const renumbered = example.replace(SEQUENCE, next);
  // A letter after the number keeps the file exactly where it sorted: `0042b_x`
  // comes after every `0042_…` and before `0043_…`.
  const lettered = example.replace(SEQUENCE, `${clash.number}b`);
  return (
    `Two different migrations share a number, usually because two branches each added ` +
    `"the next one":\n${lines.join("\n")}\n\n` +
    `  If the later one has not run anywhere yet, renumber it to the next free number:\n` +
    `    database/migrations/${example}.ts → database/migrations/${renumbered}.ts\n` +
    `  If it has already run somewhere, do not move it: a later migration may depend on\n` +
    `  it. Keep its place with a letter after the number, and pin its recorded name:\n` +
    `    database/migrations/${example}.ts → database/migrations/${lettered}.ts\n` +
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

/**
 * Split unapplied clashes by whether the database has run part of them.
 *
 * `divergent` is a clash with an applied member and a pending one: two branches
 * met, and this database ran one side first. That is the history the refusal
 * exists for. `fresh` has nothing applied — a new database, which runs the files in
 * name order like every other new database — so `migrate` warns and carries on
 * rather than stopping every new environment of an app whose clash shipped long ago.
 *
 * @internal
 */
export function _partitionMigrationNumberClashes(
  clashes: readonly _MigrationNumberClash[],
  migrations: ReadonlyArray<{ file?: string | undefined; name: string }>,
  pending: ReadonlySet<string>,
): { divergent: _MigrationNumberClash[]; fresh: _MigrationNumberClash[] } {
  const identity = new Map(migrations.map((m) => [_bareMigrationName(m.file ?? m.name), m.name]));
  const divergent: _MigrationNumberClash[] = [];
  const fresh: _MigrationNumberClash[] = [];
  for (const clash of clashes) {
    const anyApplied = clash.files.some((file) => !pending.has(identity.get(file) ?? file));
    (anyApplied ? divergent : fresh).push(clash);
  }
  return { divergent, fresh };
}

/** A path or filename reduced to its bare migration name. */
function _bareMigrationName(file: string): string {
  const normalised = file.split("\\").join("/");
  return (normalised.split("/").at(-1) ?? normalised).replace(/\.[cm]?[jt]s$/, "");
}
