/**
 * `migrate --pretend`: the SQL a migration would send, without sending it.
 *
 * The migration's `up()` runs against a recording connection published on
 * {@link TransactionContext}, which is what `Schema`, `DB` and models resolve
 * through. Every statement is captured and none reaches the database, so the
 * schema and the tracking table are untouched.
 *
 * Reads return no rows. A migration that branches on `Schema.hasTable()`, or on
 * data it selects, shows the branch an empty database would take, and a SQLite
 * column drop (which rebuilds the table from what it reads back) shows only the
 * statements that do not depend on the read. That is the honest limit of printing
 * SQL without a database to answer it, and the command says so.
 *
 * @module
 */
import type { SQLInstance } from "../db/sql-types.ts";
import type { Migration } from "./Migration.ts";
import { TransactionContext } from "../db/TransactionContext.ts";
import { dialectFor, registerConnectionDialect } from "../db/QueryBuilder.ts";

/** One statement a pretended migration would have sent. */
export interface _PretendedStatement {
  sql: string;
  params: unknown[];
}

/**
 * Run `migration.up()` against a connection that records instead of executing.
 *
 * @param migration - The migration to pretend.
 * @param like - The real connection, whose dialect the recorder takes on so the
 *   SQL is what this database would have received.
 * @returns The statements, in the order they would have run.
 * @internal
 */
export async function _pretendMigration(
  migration: Migration,
  like: SQLInstance,
): Promise<_PretendedStatement[]> {
  const statements: _PretendedStatement[] = [];
  const recorder = _recordingConnection(statements);
  registerConnectionDialect(recorder, dialectFor(like));
  await TransactionContext.run(recorder, () => migration.up());
  return statements;
}

/** A connection that records each statement it is sent, executes none, and returns no rows. */
function _recordingConnection(into: _PretendedStatement[]): SQLInstance {
  const recorder: SQLInstance = Object.assign(
    <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      into.push({ sql: strings.join("?").trim().replace(/\s+/g, " "), params: values });
      return Promise.resolve([]);
    },
    {
      // A migration that opens its own transaction records into the same list.
      begin: <T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T> => fn(recorder),
      end: async (): Promise<void> => {},
    },
  );
  return recorder;
}
