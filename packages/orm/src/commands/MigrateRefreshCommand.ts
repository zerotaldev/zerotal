import { MigrateFreshCommand } from "./MigrateFreshCommand.ts";

/**
 * `bun zt migrate:refresh` — a second name for `migrate:fresh`, pointing at the
 * same command.
 *
 * `migrate:fresh` already runs every migration's `down()` and then every `up()`
 * again, which is what "refresh" means to most people arriving here; elsewhere
 * the two names are split, and "fresh" is the one that drops the tables outright
 * without touching `down()`. So the behaviour was always there — only the name
 * people reach for was missing, and reaching for a command that does not exist
 * is how a broken `down()` stays unexercised until the day it matters.
 *
 * A subclass rather than a second implementation: one code path, two names.
 *
 * @example
 * ```bash
 * bun zt migrate:refresh
 * bun zt migrate:refresh --seed
 * ```
 *
 * @category Migrations
 */
export class MigrateRefreshCommand extends MigrateFreshCommand {
  static override commandName = "migrate:refresh";
  static override description =
    "Roll every migration back through down(), then re-run them (alias of migrate:fresh)";
}
