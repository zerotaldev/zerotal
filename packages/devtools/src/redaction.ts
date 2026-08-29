/**
 * Trace redaction.
 *
 * A trace does not stay on screen: it is streamed to the browser and written to
 * `.zerotal/devtools.sqlite`, where it sits for a day. What it carries is the
 * request's actual values — the password on a registration, a reset token, a
 * session payload, every customer email a listing selects by. An ephemeral dev
 * panel and a plaintext file with a day's worth of credentials in it are
 * different risks, so those values are masked by default and you opt individual
 * names back in.
 *
 * Three entry points, one rule. {@link redactBindings} masks query bindings by
 * the column each belongs to, recovered by pairing the SQL's placeholders with
 * the identifiers around them; when a binding cannot be attributed to a column —
 * a raw expression, a dialect this does not parse — it is masked, because
 * guessing wrong in the other direction is what writes a password to disk.
 * {@link redactValue} walks anything with named fields (a channel entry, a
 * logged object) and masks by field name. {@link redactCacheKey} masks the tail
 * of a cache key whose name says it holds a secret.
 *
 * All three share {@link isSensitiveName}, so `allow` and `deny` in the app's
 * config mean the same thing everywhere. The walk itself is `redactGraph` from
 * `@zerotal/core/security` — the same one the Inertia recorder runs, which is
 * how two recorders that must not agree on their *markers* still agree on how a
 * cycle, a depth limit, and a nested secret are handled.
 */
import { redactGraph } from "@zerotal/core/security";

export interface RedactionOptions {
  /**
   * Turn masking off entirely. Only reasonable when you are debugging the values
   * themselves and nothing sensitive is in the database.
   */
  enabled?: boolean | undefined;
  /**
   * Names whose values are safe to show in full. Matched case-insensitively
   * against the column a binding belongs to, a channel entry's field name, or a
   * cache key's segment.
   */
  allow?: string[] | undefined;
  /**
   * Extra names to mask, added to the built-in list.
   */
  deny?: string[] | undefined;
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

/** What a masked value is replaced with. */
const MASK = "‹redacted›";

/** Stand-ins for values a walk cannot render rather than will not. */
const CIRCULAR = "‹circular›";
const TOO_DEEP = "‹truncated›";

/**
 * How far {@link redactValue} descends before it stops.
 *
 * A panel row shows a few fields, not an object graph, and the walk runs on
 * every entry of every request — so the cap is about the cost of the walk as
 * much as the size of what comes out of it.
 */
const MAX_DEPTH = 6;

/** The allow/deny sets a redaction pass runs against. */
interface Rules {
  allow: Set<string>;
  deny: string[];
}

function _rules(options: RedactionOptions): Rules {
  return {
    allow: new Set((options.allow ?? []).map((c) => c.toLowerCase())),
    deny: [...SENSITIVE, ...(options.deny ?? []).map((c) => c.toLowerCase())],
  };
}

/**
 * Whether a name means "the value under me is a secret".
 *
 * The one place the rule lives, so a column, a channel field, and a cache-key
 * segment are judged the same way — and so `allow`/`deny` in the app's config
 * cannot mean one thing on the Queries tab and another on the Cache tab.
 *
 * Matching is by substring, which is why `password` covers `password_hash`. It
 * also means `author_id` matches `auth`; that is the trade the built-in list
 * makes, and `allow: ['author_id']` opts it back in.
 */
export function isSensitiveName(name: string, options: RedactionOptions = {}): boolean {
  return _sensitive(name, _rules(options));
}

function _sensitive(name: string, { allow, deny }: Rules): boolean {
  const key = name.toLowerCase();
  if (allow.has(key)) return false;
  if (STRUCTURAL.includes(key)) return false;
  return deny.some((s) => key.includes(s));
}

/**
 * Mask every field of `value` whose name says it holds a secret.
 *
 * Used at the sink boundary for the things that arrive as named fields rather
 * than as SQL — a channel entry a package recorded, an object someone passed to
 * `console.log`. A bare scalar has no name to judge it by and comes back
 * unchanged; masking on the *contents* of a string is a different, guessier job
 * this deliberately does not attempt.
 *
 * Cycles and over-deep branches are replaced rather than followed, so the result
 * is always safe to `JSON.stringify` — which is the other half of why the log
 * capture calls this: a circular argument used to throw out of the console patch.
 *
 * @returns A new value; the input is not modified.
 */
export function redactValue(value: unknown, options: RedactionOptions = {}): unknown {
  if (options.enabled === false) return value;
  const rules = _rules(options);
  return redactGraph(value, {
    sensitive: (key) => _sensitive(key, rules),
    mask: MASK,
    circular: CIRCULAR,
    tooDeep: TOO_DEEP,
    maxDepth: MAX_DEPTH,
    flatten: _flatten,
  });
}

/**
 * Three shapes that read better named than walked, and that a devtools entry
 * carries often enough to be worth naming. A function is here because
 * `JSON.stringify` drops the key it sits under, and a log line that quietly
 * loses a field is the kind of wrongness a debugging tool must not have.
 */
function _flatten(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "function") return `‹fn ${value.name || "anonymous"}›`;
  return undefined;
}

/**
 * What separates a cache key's *name* from its *value*, kept in the split so the
 * key rebuilds.
 *
 * Deliberately not `_` or `-`: those sit inside a name — `password_reset` is one
 * word — so splitting on them would mask `reset` and leave the row unreadable
 * without protecting anything.
 */
const KEY_PARTS = /([:|/.])/;

/**
 * Mask the identifying tail of a cache key whose name says it holds a secret.
 *
 * A cache key is a name and a value welded together: `password_reset:9f2c…` *is*
 * the reset token. Masking the whole key would leave the Cache tab a column of
 * `‹redacted›` with nothing to read it by, so only what follows the sensitive
 * segment goes — the name that makes the row identifiable stays.
 *
 * @returns The key with its tail masked, or the key unchanged.
 */
export function redactCacheKey(key: string, options: RedactionOptions = {}): string {
  if (options.enabled === false) return key;
  if (!key) return key;

  const rules = _rules(options);
  const parts = key.split(KEY_PARTS);
  let masked = false;

  const out = parts.map((part, i) => {
    // Odd indices are the captured separators; they hold no value.
    if (i % 2 === 1) return part;
    if (masked) return part ? MASK : part;
    if (_sensitive(part, rules)) masked = true;
    return part;
  });

  // A key with no separator to split a name from its value — `sessionabc123` —
  // cannot be trimmed to its name, so it goes whole. Naming a value we cannot
  // clear is the wrong half to keep.
  if (!masked) return key;
  return out.length === 1 ? MASK : out.join("");
}

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

  const rules = _rules(options);
  const columns = attributeBindings(sql, bindings.length);

  return bindings.map((value, i) => {
    if (value === null || value === undefined) return value;
    const column = columns[i];
    // An unattributable binding is masked: a value we cannot name is a value we
    // cannot clear.
    if (!column) return MASK;
    return _sensitive(column, rules) ? MASK : value;
  });
}

/**
 * Pair each `?` placeholder in `sql` with the column it sets or compares.
 *
 * Handles the three shapes the query builder emits: `INSERT … (cols) VALUES (?, …)`,
 * `SET col = ?`, and `WHERE col <op> ?` (including `IN (?, ?)`, where every
 * placeholder belongs to the same column). Returns `undefined` at any position it
 * cannot attribute.
 *
 * @internal
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
