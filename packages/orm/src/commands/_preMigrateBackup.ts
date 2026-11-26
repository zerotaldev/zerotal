/**
 * The snapshot `database.backupBeforeMigrate` takes before a command changes the schema.
 *
 * Shared by `migrate` and `migrate:fresh` (and so `migrate:refresh`). It lived on
 * `migrate` alone, which left the two commands that roll *everything* back — the
 * ones a backup matters most for — running with no snapshot and no word about it,
 * even with the setting on in production.
 *
 * @module
 */
import { deployEnv, isProdLike, type Command } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _rawStatement } from "../db/DB.ts";
import { BackupError, isSqliteUrl, takeBackup } from "./_backup.ts";
import { DbBackupCommand } from "./DbBackupCommand.ts";

/**
 * Where pre-migrate snapshots go.
 *
 * @internal
 */
export const _PRE_MIGRATE_BACKUP_DIR = `${DbBackupCommand.DEFAULT_DIR}/pre-migrate`;

/**
 * Take the snapshot when the setting asks for one, or say why none was taken.
 *
 * Opt-in (`database.backupBeforeMigrate`) and production-only. Throws when the
 * backup fails, so nothing is migrated over a database with no copy.
 *
 * @param command - The running command, for its output.
 * @param config - The app's config, or `undefined` when there is none to read.
 * @param skip - `--skip-backup` was passed.
 * @internal
 */
export async function _backupBeforeMigrate(
  command: Command,
  config: ConfigManager | undefined,
  skip: boolean,
): Promise<void> {
  if (config?.get<boolean>("database.backupBeforeMigrate", false) !== true) return;
  if (!isProdLike(deployEnv())) return;

  const name = (command.constructor as { commandName?: string }).commandName ?? "migrate";

  if (skip) {
    command.warn(`Skipping the pre-migrate backup (--skip-backup).`);
    return;
  }

  const url = config.get<string>("database.url", ":memory:");
  if (!isSqliteUrl(url)) {
    command.warn(
      `database.backupBeforeMigrate is on, but this database is ${url.split("://")[0]}, and ` +
        `the built-in backup is SQLite's VACUUM INTO. No backup was taken.`,
    );
    command.dim(
      "  Take one with the server's own tool (pg_dump, mysqldump) or a provider snapshot " +
        "as a deploy step before migrate.",
    );
    command.newLine();
    return;
  }

  command.section("Backup before migrate");
  try {
    const result = await takeBackup((sql) => _rawStatement(sql), {
      source: url,
      dir: _PRE_MIGRATE_BACKUP_DIR,
      keep: DbBackupCommand.DEFAULT_KEEP,
    });
    command.info(`Wrote ${result.path}`);
    command.newLine();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackupError(
      `Not migrating: database.backupBeforeMigrate is on and the backup failed. ${reason}\n` +
        `  Fix the backup, or run \`bun zt ${name} --skip-backup\` to migrate without one.`,
    );
  }
}

/**
 * The app's config from a command's container, or `undefined` when it has none.
 *
 * @internal
 */
export function _commandConfig(command: Command): ConfigManager | undefined {
  try {
    return (command.app as { container: { makeSync(k: string): unknown } }).container.makeSync(
      "config",
    ) as ConfigManager;
  } catch {
    return undefined;
  }
}
