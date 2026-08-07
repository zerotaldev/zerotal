/**
 * Query-binding redaction.
 *
 * A trace does not stay on screen: it is streamed to the browser and written to
 * `.zerotal/devtools.sqlite`, where it sits for a day. Bindings are the request's
 * actual values — the password on a registration, a reset token, a session
 * payload, every customer email a listing selects by. An ephemeral dev panel and
 * a plaintext file with a day's worth of credentials in it are different risks,
 * so the values are masked by default and you opt individual columns back in.
 *
 * Matching is on the column each binding belongs to, recovered by pairing the
 * SQL's placeholders with the identifiers around them. When a binding cannot be
 * attributed to a column — a raw expression, a dialect this does not parse — it
 * is masked, because guessing wrong in the other direction is what writes a
 * password to disk.
 */

export interface RedactionOptions {
  /**
   * Turn masking off entirely. Only reasonable when you are debugging the values
   * themselves and nothing sensitive is in the database.
   */
  enabled?: boolean;
  /**
   * Column names whose values are safe to show in full. Matched
   * case-insensitively against the column each binding belongs to.
   */
  allow?: string[];
  /**
   * Extra column names to mask, added to the built-in list.
   */
  deny?: string[];
}

/**
 * Column names masked without being asked. Substring matches, so `password`
 * covers `password_hash` and `user_password`.
 */
const SENSITIVE = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "auth",
  "credential",
  "private_key",
  "session",
  "remember_token",
  "otp",
  "two_factor",
  "totp",
  "recovery_code",
  "signature",
  "cvv",
  "card_number",
  "iban",
  "ssn",
  "id_number",
];

/** Columns always shown: structural values that make a trace readable at all. */
const STRUCTURAL = ["id", "created_at", "updated_at", "deleted_at"];

/** What a masked binding is replaced with. */
const MASK = "‹redacted›";

/**
 * Mask the bindings of `sql` that belong to a sensitive column.
 *
 * @param sql - The statement the bindings belong to, used to attribute each one to a column.
 * @param bindings - The values, positionally matched to the statement's placeholders.
 * @param options - Redaction settings from the app's `devtools` config.
 * @returns A new array; the input is not modified.
 */
export function redactBindings(
  sql: string,
  bindings: unknown[],
  options: RedactionOptions = {},
): unknown[] {
  if (options.enabled === false) return bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) return bindings;

  const allow = new Set((options.allow ?? []).map((c) => c.toLowerCase()));
  const deny = [...SENSITIVE, ...(options.deny ?? []).map((c) => c.toLowerCase())];
  const columns = attributeBindings(sql, bindings.length);

  return bindings.map((value, i) => {
    if (value === null || value === undefined) return value;
    const column = columns[i];
    // An unattributable binding is masked: a value we cannot name is a value we
    // cannot clear.
    if (!column) return MASK;
    if (allow.has(column)) return value;
    if (STRUCTURAL.includes(column)) return value;
    return deny.some((s) => column.includes(s)) ? MASK : value;
  });
}

/**
 * Pair each `?` placeholder in `sql` with the column it sets or compares.
 *
 * Handles the three shapes the query builder emits: `INSERT … (cols) VALUES (?, …)`,
 * `SET col = ?`, and `WHERE col <op> ?` (including `IN (?, ?)`, where every
 * placeholder belongs to the same column). Returns `undefined` at any position it
 * cannot attribute.
 */
export function attributeBindings(sql: string, count: number): Array<string | undefined> {
  const out: Array<string | undefined> = new Array(count).fill(undefined);
  if (count === 0) return out;

  const insertColumns = _insertColumns(sql);
  let index = 0;

  // Walk the statement placeholder by placeholder, tracking the nearest
  // identifier to the left of each one.
  const tokens = sql.match(/"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w.]*|\?|[(),=<>!]+/g) ?? [];
  let lastIdentifier: string | undefined;
  let inValues = false;
  let valuesPosition = 0;

  for (const raw of tokens) {
    if (raw === "?") {
      if (index >= count) break;
      if (inValues && insertColumns) {
        out[index] = insertColumns[valuesPosition];
        valuesPosition++;
      } else {
        out[index] = lastIdentifier;
      }
      index++;
      continue;
    }
    const token = raw.toLowerCase();
    if (token === "values") {
      inValues = true;
      valuesPosition = 0;
      continue;
    }
    if (/^[a-z_][\w.]*$/.test(token)) {
      // An operator sits between a column and its placeholders and must leave the
      // column attached — `WHERE id IN (?, ?)` belongs to `id` for both. Any other
      // keyword ends that column's scope, so `AND`/`WHERE` cannot carry a stale
      // column onto the next placeholder.
      if (_OPERATORS.has(token)) continue;
      if (_KEYWORDS.has(token)) {
        lastIdentifier = undefined;
        continue;
      }
      lastIdentifier = _bareColumn(token);
    }
  }

  return out;
}

/** Keywords that sit between a column and its placeholders, leaving it in scope. */
const _OPERATORS = new Set(["in", "like", "ilike", "between", "is", "not", "any", "all"]);

const _KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "insert",
  "into",
  "update",
  "set",
  "delete",
  "values",
  "limit",
  "offset",
  "order",
  "group",
  "by",
  "having",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "on",
  "as",

  "null",
  "returning",
  "conflict",
  "do",
  "nothing",
  "duplicate",
  "key",
]);

/** `schema.table.column` / quoted identifiers → `column`. */
function _bareColumn(identifier: string): string {
  const parts = identifier.replace(/["`[\]]/g, "").split(".");
  return (parts[parts.length - 1] ?? identifier).toLowerCase();
}

/** The column list of an `INSERT INTO t (a, b, c) VALUES …`, if this is one. */
function _insertColumns(sql: string): string[] | null {
  const match = /insert\s+(?:or\s+\w+\s+)?into\s+[^(]+\(([^)]*)\)\s*values/i.exec(sql);
  if (!match?.[1]) return null;
  return match[1].split(",").map((c) => _bareColumn(c.trim()));
}
