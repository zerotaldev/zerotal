/**
 * Does the database actually have the columns the auth mixins assume?
 *
 * `EmailVerification` and `Authenticatable` register their columns imperatively,
 * and `authSchemaConcern` adds them to an existing table at boot. That is true, it
 * is documented, and it is conditionally true — which is the part that costs
 * afternoons. It holds when the models are the schema's source of truth. When
 * migrations are, the concern only ever sees tables a migration already built, and
 * a `create users` that does not mention `email_verified_at` produces a table
 * without it.
 *
 * The failure that follows is loud but uninformative: every query touching the
 * column raises `no such column: email_verified_at`, all at once, in tests that
 * have nothing to do with email. Nothing points at the mixin.
 *
 * The doctor is in the right position to say so. It runs as a console command, so
 * the boot concern (web and test only) has not run and papered over the gap — what
 * it sees is exactly what a migration built.
 *
 * @module
 */
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { Schema, modelsByName } from "@zerotal/orm";
import { hasEmailVerification } from "./EmailVerification.ts";
import { isAuthenticatable } from "./Authenticatable.ts";

/** A column an auth mixin needs, and the table it is missing from. */
export interface MissingAuthColumn {
  table: string;
  column: string;
  /** The mixin that assumes it. */
  mixin: string;
  /** The column type a migration should give it. */
  migration: string;
}

/**
 * Every auth column missing from the table of a model that composes the mixin
 * needing it.
 *
 * @returns The gaps, or `[]` when there are none — and also `[]` when there is no
 *   database to ask, which is not a finding about the app.
 */
export async function missingAuthColumns(): Promise<MissingAuthColumn[]> {
  const missing: MissingAuthColumn[] = [];
  try {
    for (const model of modelsByName.values()) {
      const table = (model as { table?: string }).table;
      if (!table || !(await Schema.hasTable(table))) continue;

      if (hasEmailVerification(model) && !(await Schema.hasColumn(table, "email_verified_at"))) {
        missing.push({
          table,
          column: "email_verified_at",
          mixin: "EmailVerification",
          migration: `t.dateTime("email_verified_at").nullable()`,
        });
      }
      if (isAuthenticatable(model) && !(await Schema.hasColumn(table, "remember_token"))) {
        missing.push({
          table,
          column: "remember_token",
          mixin: "Authenticatable",
          migration: `t.string("remember_token").nullable()`,
        });
      }
    }
  } catch {
    // No database in this runtime, or DDL introspection is not permitted. Silence
    // is right: the doctor was asked about the app, not about its connection.
    return [];
  }
  return missing;
}

/**
 * The check. A failure, not a warning: a column the mixin's own methods read is
 * missing, so the feature is already broken — this only decides whether you find
 * out here or from 419 red tests.
 */
export const authSchemaCheck: DoctorCheck = {
  id: "auth-schema-columns",
  label: "Auth columns",
  async run(): Promise<DoctorCheckResult> {
    const missing = await missingAuthColumns();
    if (missing.length === 0) {
      return { status: "ok", message: "every auth mixin's column is on its table." };
    }

    const named = missing.map((m) => `${m.table}.${m.column} (${m.mixin})`).join(", ");
    const first = missing[0]!;
    return {
      status: "fail",
      message:
        `${named} — the mixin registers the column imperatively and the boot concern only ` +
        `adds it to a table that already exists, so a migration that created this table ` +
        `without it leaves every query touching it failing with \`no such column\`.`,
      fix:
        `Add it in a migration, guarded — unguarded it collides with a database the boot ` +
        `concern has already fixed up, and that collision lands during deploy:\n` +
        `        if (!(await Schema.hasColumn("${first.table}", "${first.column}"))) {\n` +
        `          await Schema.table("${first.table}", (t) => ${first.migration});\n` +
        `        }`,
    };
  },
};
