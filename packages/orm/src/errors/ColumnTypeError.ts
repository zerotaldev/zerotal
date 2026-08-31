import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a boolean is written to a column declared to hold text.
 *
 * The reason this is an error rather than a coercion is that there is no correct
 * coercion. SQLite gives a `TEXT` column text affinity, so an integer `0` written
 * there is stored as the string `"0"` — and `"0"` is truthy in JavaScript. A
 * `false` written to a text column therefore reads back as something that passes
 * `if (model.flag)`, silently, on every row, forever. Writing `"false"` has the
 * same problem. The value cannot survive the round trip, so the write is refused
 * instead of being quietly made wrong.
 *
 * **A bare `@column()` is a text column.** With no argument it resolves to
 * `{ type: "string" }`, which is the right default for the common case and the
 * trap here: a boolean property decorated with a bare `@column()` looks declared
 * and is stored as text. The `declare` keyword erases the property's TypeScript
 * type at runtime, so the decorator cannot infer `boolean` and pick for you —
 * which is exactly why the mistake is worth naming loudly rather than guessing at.
 *
 * Reported from production: a feature flag read as enabled for every record that
 * had it turned off, and nothing in the app or the database registered a fault.
 */
export class ColumnTypeError extends ZerotalError {
  constructor(column: string, declared: string) {
    super(
      `[Zerotal ORM] ${column} is declared as a \`${declared}\` column and was given a boolean. ` +
        `A text column stores that as "0"/"1", and "0" is truthy in JavaScript — so a stored ` +
        `\`false\` would read back as true and every \`if (…)\` on it would take the wrong branch. ` +
        `Declare the column's type instead: \`@column("boolean")\`. ` +
        `A bare \`@column()\` defaults to \`string\`, which is the usual cause. ` +
        `If you genuinely want the text "true"/"false", assign a string.`,
      "E_COLUMN_TYPE",
      500,
      { column, declared },
    );
    this.name = "ColumnTypeError";
  }
}
