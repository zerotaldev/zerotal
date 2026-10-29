/**
 * Build the `strings` argument for a Bun SQL tagged-template call from plain strings.
 *
 * Bun's `sql` function wants what the language hands a tag: a frozen array whose `raw`
 * is a property you cannot see when you enumerate it. `Object.assign(parts, { raw: parts })`
 * makes the property enumerable, and Bun 1.4.4 refuses that with "has an enumerable 'raw'
 * property, so it is not a template object" — every statement built from a runtime-assembled
 * string failed, which is nearly everything the ORM sends. `defineProperty` leaves `raw`
 * non-enumerable, as a real template object has it.
 *
 * Copies its input, so the caller's array is neither frozen nor given a `raw`.
 *
 * @internal Shared by the ORM and by the packages that issue SQL of their own.
 */
export function _templateStrings(parts: readonly string[]): TemplateStringsArray {
  const strings = [...parts];
  Object.defineProperty(strings, "raw", { value: strings });
  return Object.freeze(strings) as TemplateStringsArray;
}

/**
 * Split SQL written with `?` placeholders into the text around them, which is the `strings` of a
 * tagged-template call: a statement with `n` placeholders gives `n + 1` parts.
 *
 * Only a `?` the database would read as a placeholder counts. Splitting on every `?` made one
 * inside a string literal or a comment a placeholder too, so `title = 'Why?' AND n = ?` bound its
 * one value to the literal, left the real placeholder empty, and could return no rows instead of
 * failing. This skips:
 *
 * - quoted text, `'…'` and `"…"`, where a doubled quote is an escape (and so is a backslash on
 *   MySQL, and in a PostgreSQL `E'…'` string)
 * - quoted identifiers, `` `…` `` on MySQL and SQLite and `[…]` on SQLite, so an apostrophe in a
 *   column name does not open a string
 * - block comments, and line comments: `--` (on MySQL only when whitespace, a control character
 *   or the end follows, so `5--1` is arithmetic there) and `#` on MySQL
 * - on PostgreSQL, dollar-quoted bodies (`$$…$$`, `$fn$…$fn$`) and the jsonb operators `?|`
 *   and `?&`
 *
 * A bare `?` is always a placeholder here. PostgreSQL's jsonb key-existence operator is spelled
 * the same, so a caller that allows it treats a placeholder with no binding left as the operator.
 *
 * @internal Shared by the ORM's string-form SQL: `DB.raw`, `whereRaw` and friends, and schema
 * and migration statements.
 */
export function _splitPlaceholders(
  sql: string,
  dialect: "sqlite" | "postgres" | "mysql" = "sqlite",
): string[] {
  const parts: string[] = [];
  const n = sql.length;
  let start = 0;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const backslash =
        dialect === "mysql" ||
        (dialect === "postgres" &&
          c === "'" &&
          (sql[i - 1] === "E" || sql[i - 1] === "e") &&
          !_isWord(sql[i - 2]));
      i = _skipQuoted(sql, i, c, backslash);
    } else if (c === "`" && dialect !== "postgres") {
      i = _skipQuoted(sql, i, c, false);
    } else if (c === "[" && dialect === "sqlite") {
      const end = sql.indexOf("]", i + 1);
      i = end === -1 ? n : end + 1;
    } else if (c === "-" && sql[i + 1] === "-" && (dialect !== "mysql" || _mysqlDashes(sql, i))) {
      i = _lineEnd(sql, i + 2);
    } else if (c === "#" && dialect === "mysql") {
      i = _lineEnd(sql, i + 1);
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "$" && dialect === "postgres") {
      i = _skipDollarQuoted(sql, i);
    } else if (c === "?") {
      const next = sql[i + 1];
      // `?|` and `?&` are jsonb operators; `?||` and `?&&` are a placeholder and an operator.
      if (dialect === "postgres" && (next === "|" || next === "&") && sql[i + 2] !== next) {
        i += 2;
        continue;
      }
      parts.push(sql.slice(start, i));
      start = ++i;
    } else {
      i++;
    }
  }
  parts.push(sql.slice(start));
  return parts;
}

function _isWord(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

/**
 * Whether MySQL reads the `--` at `at` as a comment. It does only when whitespace or a control
 * character follows, or nothing does: `SELECT 5--1` is five minus minus one.
 */
function _mysqlDashes(sql: string, at: number): boolean {
  return at + 2 >= sql.length || sql.charCodeAt(at + 2) <= 0x20;
}

/** Index just past the quoted text that opens at `open`, or the end when it never closes. */
function _skipQuoted(sql: string, open: number, quote: string, backslash: boolean): number {
  let i = open + 1;
  while (i < sql.length) {
    const c = sql[i]!;
    if (backslash && c === "\\") {
      i += 2;
    } else if (c === quote) {
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  return sql.length;
}

/** Index of the line break that ends a line comment, or the end. */
function _lineEnd(sql: string, from: number): number {
  const end = sql.indexOf("\n", from);
  return end === -1 ? sql.length : end;
}

const _DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/** Past a PostgreSQL dollar-quoted body that opens at `at`, or past the `$` when none does. */
function _skipDollarQuoted(sql: string, at: number): number {
  // `$1` and a `$` inside an identifier do not open one.
  if (_isWord(sql[at - 1])) return at + 1;
  _DOLLAR_TAG.lastIndex = at;
  const tag = _DOLLAR_TAG.exec(sql);
  if (!tag) return at + 1;
  const end = sql.indexOf(tag[0], at + tag[0].length);
  return end === -1 ? sql.length : end + tag[0].length;
}
