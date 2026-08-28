/**
 * `zt doctor` — are there migrations on disk that have not run?
 *
 * The same question the dev error overlay answers, asked before anything breaks.
 * The overlay is reactive by nature: it needs a request to have already failed
 * with `no such table: assets`, which means somebody already lost the thread of
 * what they were doing. `doctor` is where that finding belongs when nothing has
 * gone wrong yet — it already boots the app, already holds a connection, and
 * already exists to report the silent things.
 *
 * A warning, never a failure. Pending migrations are the *normal* state of a
 * checkout that just pulled, and a doctor that fails there would be one people
 * learn to ignore. The deploy pipeline is the place where they must be applied,
 * and it runs `migrate` as a step rather than asking about it.
 *
 * @module
 */
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { pendingMigrations } from "./missingRelation.ts";

/** How many migration names to print before summarising the rest. */
const NAMED = 5;

/**
 * The check.
 *
 * Silent when nothing is pending, silent when there is no database to ask, and
 * specific when there is something to say — the names, because "3 pending" sends
 * you to `migrate:status` to find out which, and this already knows.
 */
export const pendingMigrationsCheck: DoctorCheck = {
  id: "pending-migrations",
  label: "Migrations",
  async run(): Promise<DoctorCheckResult> {
    let pending: string[];
    try {
      pending = await pendingMigrations();
    } catch {
      // No connection, no migrations directory, or a driver that will not answer.
      // None of those is a finding about migrations, and guessing would make this
      // check the noisiest thing in the report on every app that has no database.
      return { status: "ok", message: "no migration state to read." };
    }

    if (pending.length === 0) {
      return { status: "ok", message: "every migration on disk has run." };
    }

    const shown = pending.slice(0, NAMED).join(", ");
    const rest = pending.length - NAMED;
    return {
      status: "warn",
      message:
        `${pending.length} migration(s) have not run: ${shown}${rest > 0 ? `, and ${rest} more` : ""}. ` +
        `Until they do, any query touching what they create fails with \`no such table\` — ` +
        `an error whose stack is entirely framework frames.`,
      fix: "bun zt migrate",
    };
  },
};
