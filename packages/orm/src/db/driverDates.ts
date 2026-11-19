/**
 * Dates as they come back from the database, made to mean the same instant on
 * every supported Bun.
 *
 * Two things read a stored date differently depending on where the process runs,
 * and both are corrected here rather than at each call site.
 *
 * **A date-time string with no zone.** The ORM writes every date as UTC. On
 * SQLite and PostgreSQL it writes ISO 8601 with a `Z`; MySQL's `DATETIME` refuses
 * the `T` and the `Z`, so there it writes `YYYY-MM-DD HH:MM:SS` — still UTC, but
 * with nothing in the text to say so. Parsed as it stands, that text is local
 * time, so on a server whose `TZ` is not UTC every MySQL date read back moved by
 * the zone's offset. SQLite's own `CURRENT_TIMESTAMP` is written the same way and
 * is UTC too. {@link _dbDateString} reads such text as the UTC it was written as.
 *
 * **A MySQL `DATE`, `DATETIME` or `TIMESTAMP` the driver decoded.** Bun binds a
 * `Date` parameter as its UTC fields. Bun 1.3 decoded those columns back as
 * *local* fields, so a value read back moved by the zone's offset; Bun 1.4 decodes
 * them as UTC. {@link _normalizeMysqlRows} finds out which this runtime does, once,
 * by asking the server for a known value, and corrects the local reading to the
 * UTC one, so a row holds the same `Date` on both.
 *
 * **A PostgreSQL `timestamp` the driver read as text.** Bun 1.3 parses
 * `timestamp without time zone` text as local time, and it asks for text on the
 * first run, per connection, of a statement with no bound parameters.
 * {@link _pgBoundStatement} gives such a statement one, so Bun asks for binary,
 * which it decodes as UTC like every other run.
 *
 * @module
 */
import { _templateStrings } from "./templateStrings.ts";
import type { SQLInstance } from "./sql-types.ts";

// ── Strings ──────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD HH:MM[:SS[.fff]]`, with a space or a `T`, and no zone. */
const ZONELESS_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)$/;

/**
 * A stored date-time string, with `Z` added when it carries no zone of its own.
 *
 * Anything else — a string that already has an offset, a date with no time, text
 * that is not a date at all — is returned unchanged.
 *
 * @internal
 */
export function _dbDateString(value: string): string {
  const match = ZONELESS_DATE_TIME.exec(value.trim());
  return match ? `${match[1]}T${match[2]}Z` : value;
}

/**
 * Whether a value the driver returned is a date no `Carbon` can hold: an invalid
 * `Date`, or a non-finite number.
 *
 * PostgreSQL's `infinity` and `-infinity` arrive as either, depending on the Bun
 * release — an invalid `Date` on 1.3, `Infinity` or `-Infinity` on 1.4 — and so
 * does a MySQL zero date (`0000-00-00`) on 1.4.
 *
 * @internal
 */
export function _isUnrepresentableDate(value: unknown): boolean {
  if (value instanceof Date) return Number.isNaN(value.getTime());
  return typeof value === "number" && !Number.isFinite(value);
}

/**
 * The error for a date column whose value cannot be a `Carbon`, naming the column.
 *
 * The same on every Bun: what reached the cast differs between releases, and
 * without this the message did too — and named neither the column nor the value.
 *
 * @internal
 */
export function _unrepresentableDateError(label: string, value: unknown): RangeError {
  const shown =
    typeof value === "number"
      ? String(value)
      : "an invalid date (PostgreSQL infinity, or a zero date)";
  return new RangeError(
    `[Zerotal ORM] ${label} holds ${shown}, which a date cast cannot represent. ` +
      "Store a real date, or read the column through a custom cast that handles it.",
  );
}

// ── MySQL decoding ───────────────────────────────────────────────────────────

/**
 * How this runtime's MySQL driver turns a stored `DATETIME` into a `Date`:
 * `"utc"` reads the stored fields as UTC, `"local"` as local time, and `"same"`
 * means the process zone has no offset to tell the two apart.
 */
export type MysqlDateDecoding = "utc" | "local" | "same";

/** Per process zone, since the answer for "local" depends on which zone that is. */
let _decoding: { zone: string; mode: Promise<MysqlDateDecoding> } | null = null;

/** The process zone as the runtime currently resolves it; `TZ` can change at runtime. */
function processZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A wall-clock time at which the process zone is not at UTC, or `null` when it
 * never is — then reading the fields as local or as UTC gives the same instant.
 */
function probeFields(): [number, number, number] | null {
  const year = new Date().getFullYear();
  for (const [y, m] of [
    [year, 0],
    [year, 6],
    [2000, 0],
    [2000, 6],
  ] as const) {
    if (new Date(y, m, 1, 12).getTimezoneOffset() !== 0) return [y, m, 1];
  }
  return null;
}

async function probe(conn: SQLInstance): Promise<MysqlDateDecoding> {
  const fields = probeFields();
  if (!fields) return "same";
  const [y, m, d] = fields;
  const text = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 12:00:00`;
  // A tagged template, so it takes the same prepared-statement path as every
  // query the ORM sends — the text protocol decodes dates by different rules.
  const rows = await conn<{ zt_probe: unknown }>(
    _templateStrings([`SELECT CAST('${text}' AS DATETIME) AS zt_probe`]),
  );
  const got = rows[0]?.zt_probe;
  if (!(got instanceof Date)) return "utc";
  if (got.getTime() === new Date(y, m, d, 12).getTime()) return "local";
  return "utc";
}

/**
 * Which way this runtime decodes MySQL dates, asked of the server once per
 * process zone and remembered.
 *
 * A failed probe is not remembered, so the next query asks again.
 *
 * @internal
 */
export function _mysqlDateDecoding(conn: SQLInstance): Promise<MysqlDateDecoding> {
  const zone = processZone();
  if (_decoding?.zone === zone) return _decoding.mode;
  const mode = probe(conn);
  const entry = { zone, mode };
  _decoding = entry;
  mode.catch(() => {
    if (_decoding === entry) _decoding = null;
  });
  return mode;
}

/**
 * Forget the probed decoding, so the next MySQL read asks again.
 *
 * @internal For tests.
 */
export function _resetMysqlDateDecoding(): void {
  _decoding = null;
}

/**
 * The instant a MySQL date means, given a `Date` the driver read as local time.
 *
 * The local fields of `date` are the fields MySQL stored, and the ORM stores UTC —
 * except for stored fields in the process zone's daylight-saving gap, which no local
 * time has: the runtime moved them forward an hour before this sees them, and the
 * value reads back an hour late. Bun 1.4, or `TZ=UTC` on 1.3, never takes this path.
 *
 * The epoch is returned as it is. Bun 1.3 returns the zero date `0000-00-00` as the
 * epoch itself rather than through the local reading, in every zone, and it is the
 * same number as a stored value whose fields are the epoch's wall-clock time in the
 * process zone (`1969-12-31 19:00:00` under `America/New_York`). Nothing tells the
 * two apart, so both stay the epoch: a zero date reads as `1970-01-01T00:00:00Z` on
 * Bun 1.3 in every zone, as it did before this correction existed, and that one
 * stored value reads the same. Turning the epoch into an invalid `Date` instead, as
 * Bun 1.4 returns a zero date, would also turn `1970-01-01` into one under a UTC
 * process zone, where Bun 1.3 reads it correctly.
 *
 * @internal
 */
export function _localFieldsAsUtc(date: Date): Date {
  const ms = date.getTime();
  if (Number.isNaN(ms) || ms === 0) return date;
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  utc.setUTCHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return utc;
}

/**
 * Rows from a MySQL connection, with every `Date` holding the instant MySQL
 * stored whichever Bun decoded it.
 *
 * Rows without a `Date` in them are returned untouched and cost no probe. The
 * correction is made in place, so the array keeps the driver's `count` and
 * `affectedRows`.
 *
 * @internal
 */
export async function _normalizeMysqlRows<T>(conn: SQLInstance, rows: T[]): Promise<T[]> {
  const columns = dateColumns(rows);
  if (columns.length === 0) return rows;
  let mode: MysqlDateDecoding;
  try {
    mode = await _mysqlDateDecoding(conn);
  } catch {
    return rows;
  }
  if (mode !== "local") return rows;
  for (const row of rows as Record<string, unknown>[]) {
    for (const key of columns) {
      const value = row[key];
      if (value instanceof Date) row[key] = _localFieldsAsUtc(value);
    }
  }
  return rows;
}

// ── PostgreSQL result format ─────────────────────────────────────────────────

/** Bun before 1.4 parses `timestamp without time zone` text as local time. */
const BUN_PARSES_PG_TEXT_AS_LOCAL = ((): boolean => {
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  return major < 1 || (major === 1 && minor < 4);
})();

let _pgBindOverride: boolean | null = null;

/** Whether a PostgreSQL statement with no parameters needs one added, now. */
function pgNeedsBoundParameter(): boolean {
  if (_pgBindOverride !== null) return _pgBindOverride;
  return BUN_PARSES_PG_TEXT_AS_LOCAL && probeFields() !== null;
}

/**
 * Decide for tests whether {@link _pgBoundStatement} adds a parameter: `true` or
 * `false` as on a Bun that needs it or not, `null` to go back to asking the runtime.
 *
 * @internal For tests.
 */
export function _setPgBoundParameter(on: boolean | null): void {
  _pgBindOverride = on;
}

/** A statement that can return rows, which a `WITH` clause can precede. */
const PG_ROW_STATEMENT = /^\s*(?:select|values|table|insert|update|delete)\b/i;
const PG_WITH = /^\s*with(\s+recursive)?\s/i;

/**
 * The `strings` and values to send for a PostgreSQL statement, with one unused bound
 * parameter added when it has none and this runtime needs one.
 *
 * Bun asks PostgreSQL for results in binary, which it decodes as UTC — except on the
 * first run, on each connection, of a statement with no parameters, which it sends
 * in one go before it knows the column types, and so asks for text. Bun 1.3 parses
 * `timestamp without time zone` text as local time: under a `TZ` that is not UTC,
 * `Model.query().get()` or a `DB.raw()` with no bindings read such a column moved by
 * the offset the first time and correctly after. Bun 1.4 parses the text as UTC.
 *
 * A statement with a parameter is described before it is bound, so Bun asks for
 * binary from its first run. The parameter goes in a `WITH` clause nothing reads:
 * `WITH zt_bind AS (SELECT $1::int) SELECT …`, which PostgreSQL never evaluates.
 * Only a statement that starts with `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`,
 * `UPDATE` or `DELETE` is changed; anything else, and every statement on Bun 1.4 or
 * under a process zone with no offset, is returned as it was.
 *
 * @internal
 */
export function _pgBoundStatement(
  strings: readonly string[],
  values: readonly unknown[],
): [readonly string[], readonly unknown[]] {
  if (values.length > 0 || strings.length !== 1 || !pgNeedsBoundParameter()) {
    return [strings, values];
  }
  const sql = strings[0]!;
  const withClause = PG_WITH.exec(sql);
  if (withClause) {
    const rest = sql.slice(withClause[0].length);
    return [[`WITH${withClause[1] ?? ""} zt_bind AS (SELECT `, `::int), ${rest}`], [1]];
  }
  if (!PG_ROW_STATEMENT.test(sql)) return [strings, values];
  return [["WITH zt_bind AS (SELECT ", `::int) ${sql}`], [1]];
}

/** Rewritten templates by the one they replace, so Bun can reuse its prepared statement. */
const _pgTemplates = new WeakMap<TemplateStringsArray, TemplateStringsArray>();

/**
 * {@link _pgBoundStatement} for a tagged-template call: the same template object
 * back for the same call site, as Bun's statement cache needs.
 *
 * @internal
 */
export function _pgBoundTemplate(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): [TemplateStringsArray, readonly unknown[]] {
  const [sendStrings, sendValues] = _pgBoundStatement(strings, values);
  if (sendStrings === strings) return [strings, values];
  let tpl = _pgTemplates.get(strings);
  if (!tpl) {
    tpl = _templateStrings(sendStrings);
    _pgTemplates.set(strings, tpl);
  }
  return [tpl, sendValues];
}

/**
 * The columns of a result that hold a `Date` in some row.
 *
 * The driver decodes a column one way for every row, so a column whose first value
 * is neither a `Date` nor `null` holds no dates, and only the rest are scanned —
 * a large result with no date columns costs one look at its first row.
 */
function dateColumns(rows: unknown[]): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0];
  if (first === null || typeof first !== "object") return [];
  const candidates = Object.keys(first).filter((key) => {
    const value = (first as Record<string, unknown>)[key];
    return value === null || value instanceof Date;
  });
  return candidates.filter((key) =>
    rows.some((row) => (row as Record<string, unknown> | null)?.[key] instanceof Date),
  );
}
