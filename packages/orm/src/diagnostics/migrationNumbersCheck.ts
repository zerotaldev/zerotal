/**
 * `zt doctor` — do two different migrations share a number?
 *
 * Two branches cut from the same main each add "the next" migration, both merge,
 * and the app has `0042_add_invoices` and `0042_add_refunds`. `zt migrate` refuses
 * to run over that, but the deploy is the expensive place to find out. A pull
 * request's CI runs on the merge result, so `doctor` there sees both files the
 * moment they meet, before either reaches main.
 *
 * A failure while any of the clashing migrations is unapplied; a warning when all
 * of them have already run, because that clash is history — renumbering an applied
 * migration needs its identity pinned, and nothing breaks if it stays.
 *
 * @module
 */
import { _scanAppFiles } from "@zerotal/core/runtime";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { _getConnection } from "../db/DB.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import {
  _describeMigrationNumberClashes,
  _migrationNumberClashes,
  _unappliedMigrationNumberClashes,
} from "../schema/migrationNumbers.ts";
import { loadMigrations } from "../commands/_loadMigrations.ts";
import { _nextMigrationPrefix } from "../commands/MakeMigrationCommand.ts";

/** The check. */
export const migrationNumbersCheck: DoctorCheck = {
  id: "migration-numbers",
  label: "Migration numbers",
  async run(): Promise<DoctorCheckResult> {
    let files: string[];
    try {
      files = await _scanAppFiles(`${process.cwd()}/database/migrations`, "*.ts");
    } catch {
      return { status: "ok", message: "no migrations directory." };
    }

    const clashes = _migrationNumberClashes(files);
    if (clashes.length === 0) {
      return { status: "ok", message: `${files.length} migration(s), every number unique.` };
    }

    const next = _nextMigrationPrefix(files);
    const unapplied = await _unappliedOrAll(clashes);
    if (unapplied.length > 0) {
      return {
        status: "fail",
        message: _describeMigrationNumberClashes(unapplied, next),
        fix: "Renumber the newer migration; `bun zt migrate` refuses to run until you do.",
      };
    }
    return {
      status: "warn",
      message:
        `${_describeMigrationNumberClashes(clashes, next)}\n\n` +
        `  Every one of them has already run here, so nothing will break; the next ` +
        `migration should still take ${next}.`,
    };
  },
};

/**
 * The clashes with a member not yet applied — or all of them, when there is no
 * database to ask. On a CI runner without one, the safe reading is that nothing
 * has run.
 */
async function _unappliedOrAll(
  clashes: ReturnType<typeof _migrationNumberClashes>,
): Promise<ReturnType<typeof _migrationNumberClashes>> {
  try {
    const records = await loadMigrations();
    const runner = new MigrationRunner({ connection: _getConnection() });
    const pending = await runner.pending(
      records.map((r) => ({ name: r.name, migration: r.instance })),
    );
    return _unappliedMigrationNumberClashes(records, new Set(pending));
  } catch {
    return clashes;
  }
}
