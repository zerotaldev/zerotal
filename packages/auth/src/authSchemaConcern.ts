import type { ConcernDescriptor } from "@zerotal/core";
import { Schema, modelsByName } from "@zerotal/orm";
import { hasEmailVerification } from "./EmailVerification.ts";
import { isAuthenticatable } from "./Authenticatable.ts";

/**
 * Provisions the auxiliary schema the auth mixins rely on — so apps don't declare a
 * token model or hand-write a migration for it. Runs once after model discovery
 * (order 70, post-`models`), additively and idempotently:
 *
 *  - `email_verified_at` column — added to the table of any model composing
 *    `EmailVerification` (when the table exists but the column doesn't).
 *
 * **This adds columns to existing tables; it does not create them.** When the
 * table is not there yet, something else builds it — and what that is decides
 * whether the column comes with it. Schema sync builds from the models, so the
 * imperatively-registered column is included. A migration builds from what the
 * migration says, so a `create users` that does not mention `email_verified_at`
 * produces a table without it, and this concern never revisits a table it has
 * already seen exist. An app whose source of truth is migrations therefore needs
 * the column in one, guarded with `Schema.hasColumn` — unguarded it collides with
 * a database this concern has already fixed up. Same for `remember_token`.
 *
 * Both email-verification and password-reset links are stateless signed tokens, so there
 * are no token tables to provision. Restricted to environments with a live database; any
 * DDL/connection error is swallowed so a DB-less runtime (e.g. a console command) still boots.
 */
export const authSchemaConcern: ConcernDescriptor = {
  name: "auth-schema",
  order: 70,
  envs: ["web", "test"],
  async run() {
    try {
      const models = [...modelsByName.values()];

      for (const model of models) {
        if (hasEmailVerification(model)) {
          const table = (model as { table?: string }).table;
          if (table && (await Schema.hasTable(table))) {
            if (!(await Schema.hasColumn(table, "email_verified_at"))) {
              await Schema.table(table, (blueprint) => {
                blueprint.dateTime("email_verified_at").nullable();
              });
            }
          }
        }

        // "Remember me" token column for every authenticatable model.
        if (isAuthenticatable(model)) {
          const table = (model as { table?: string }).table;
          if (table && (await Schema.hasTable(table))) {
            if (!(await Schema.hasColumn(table, "remember_token"))) {
              await Schema.table(table, (blueprint) => {
                blueprint.string("remember_token").nullable();
              });
            }
          }
        }
      }
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
