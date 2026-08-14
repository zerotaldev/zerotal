import { ZerotalError, FrameworkEvents } from "@zerotal/core";
import { NPlusOneDetected } from "../events.ts";

// ── N+1 Query Detector ────────────────────────────────────────────────────────
//
// Enabled automatically in local/development environments (APP_ENV = local |
// development | dev).  Disabled in production and test automatically; call
// preventNPlusOne() to enable it in any other environment.
//
// How it works:
//   Every SELECT shares a normalised SQL fingerprint (the _tplCache key from
//   QueryBuilder: string fragments joined with \x00).  Per-request counts are
//   tracked in a WeakMap keyed by the HttpContext object — no extra ALS setup,
//   no memory leaks: the map entry is GC'd with the request context.
//
//   When a fingerprint crosses the threshold in one request the detector fires.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown (in `throw` mode) or logged (in `warn` mode) when one normalised query
 * shape runs more times than the configured threshold within a single request —
 * the signature of an N+1 access pattern. Carries the offending `fingerprint`
 * and its `count`; error code `E_N_PLUS_ONE`.
 */
export class NPlusOneError extends ZerotalError {
  readonly fingerprint: string;
  readonly count: number;
  /**
   * How many distinct argument tuples the shape ran with.
   *
   * The difference between the two diagnoses. `1` means the same query with the
   * same arguments ran N times — nothing to eager-load, the answer is to ask
   * once. Anything higher is the classic per-row lookup.
   */
  readonly distinctArgs: number;

  constructor(fingerprint: string, count: number, distinctArgs = 0) {
    const sql = fingerprint.replaceAll("\x00", "?");
    // Sending someone to look for a relation to eager-load, when the query is
    // the *same* one repeated with the *same* arguments, wastes the time the
    // warning was supposed to save. Say which of the two this is.
    const diagnosis =
      distinctArgs === 1
        ? `with the same arguments every time. That is not a per-row lookup — nothing to\n` +
          `eager-load — it is the same answer fetched repeatedly.\n\n` +
          `Fix: ask once per request.\n` +
          `  const rows = await RequestContext.remember('key', () => …);\n`
        : `with ${distinctArgs > 0 ? `${distinctArgs} different argument sets` : "varying arguments"}. ` +
          `This is the classic N+1 access pattern.\n\n` +
          `Fix: load the relation eagerly using .with('relation') on your query,\n` +
          `call await model.load('relation') before the loop, or collapse the loop\n` +
          `into a single .whereIn(...).\n`;

    super(
      `NPlusOneError: The query\n\n` +
        `  ${sql}\n\n` +
        `was executed ${count} times in a single request, ${diagnosis}\n` +
        `To suppress for a specific table or pattern:\n` +
        `  DB.allowNPlusOne('table_name')           // permanent\n` +
        `  DB.allowNPlusOne('table_name', { once: true })  // this request only\n\n` +
        `Set APP_ENV=production to disable this check entirely.`,
      "E_N_PLUS_ONE",
      500,
    );
    this.fingerprint = fingerprint;
    this.count = count;
    this.distinctArgs = distinctArgs;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

/** What one query shape did during one request. */
interface ShapeStats {
  count: number;
  /**
   * Distinct argument tuples seen, capped.
   *
   * Capped because a genuine 500-iteration loop would otherwise hold 500 keys
   * for the life of the request to answer a question — "is this one argument or
   * many?" — that a handful already settles.
   */
  args: Set<string>;
}

/** How many distinct argument tuples to remember per shape before giving up counting. */
const _ARG_SAMPLE_CAP = 32;

/** Per-request query-shape stats. Keyed by the HttpContext object. */
const _counts = new WeakMap<object, Map<string, ShapeStats>>();

/** Once-per-request suppressions. Cleared automatically when the context is GC'd. */
const _onceSuppressed = new WeakMap<object, Set<string>>();

/** Permanent (process-level) suppression patterns (matched as substrings). */
const _suppressed = new Set<string>();

let _threshold = 5;
let _mode: "warn" | "throw" = "warn";
let _forced = false; // true when explicitly configured via preventNPlusOne()

// ── Public API ────────────────────────────────────────────────────────────────

export interface NPlusOneOptions {
  /** How many identical query shapes in one request triggers a violation. Default: 5. */
  threshold?: number;
  /**
   * 'warn'  → console.warn (default — non-breaking, still visible)
   * 'throw' → throws NPlusOneError (good for CI / strict mode)
   */
  mode?: "warn" | "throw";
}

/**
 * Configure N+1 query detection.
 *
 * Call once at application boot to enable detection in any environment.
 * In `local` and `development` environments detection is already active with
 * default settings — call this to change the threshold or switch to 'throw'.
 *
 * @example
 * // bootstrap/app.ts (development)
 * import { DB } from '@zerotal/orm';
 * DB.preventNPlusOne({ threshold: 3, mode: 'throw' });
 */
export function preventNPlusOne(options: NPlusOneOptions = {}): void {
  _threshold = options.threshold ?? _threshold;
  _mode = options.mode ?? _mode;
  _forced = true;
}

/**
 * Suppress N+1 warnings for queries involving `pattern` (matched as a
 * case-insensitive substring of the SQL shape).
 *
 * @param pattern  A table name or any substring of the SQL fingerprint.
 * @param options  `{ once: true }` — suppress only for the current request.
 *
 * @example
 * DB.allowNPlusOne('activity_logs');              // permanent
 * DB.allowNPlusOne('taggings', { once: true });   // this request only
 */
export function allowNPlusOne(
  pattern: string,
  options?: { once?: boolean },
  ctx?: object | null,
): void {
  if (options?.once) {
    if (!ctx) return;
    if (!_onceSuppressed.has(ctx)) _onceSuppressed.set(ctx, new Set());
    _onceSuppressed.get(ctx)!.add(pattern.toLowerCase());
  } else {
    _suppressed.add(pattern.toLowerCase());
  }
}

/** @internal — reset all state (used in tests). */
export function _resetNPlusOne(): void {
  _suppressed.clear();
  _threshold = 5;
  _mode = "warn";
  _forced = false;
}

// ── Core tracking ─────────────────────────────────────────────────────────────

/**
 * @internal — called by QueryBuilder._run() on every query execution.
 *
 * @param values - The bound parameters. Optional so older call sites still
 *   compile; without them the detector cannot tell a per-row lookup from the
 *   same read repeated, and says so less precisely.
 */
export function trackQuery(
  ctx: object | null | undefined,
  fingerprint: string,
  values?: readonly unknown[],
): void {
  if (!ctx) return;

  // Honour explicit opt-in or auto-enable in local/development only
  if (!_forced) {
    const env = (typeof Bun !== "undefined" ? Bun.env["APP_ENV"] : undefined) ?? "";
    if (env !== "local" && env !== "development" && env !== "dev") return;
  }

  // Production always off
  const env = (typeof Bun !== "undefined" ? Bun.env["APP_ENV"] : undefined) ?? "";
  if (env === "production" || env === "prod") return;

  // Only watch SELECTs — the N+1 problem is purely about reads
  if (!fingerprint.trimStart().toLowerCase().startsWith("select")) return;

  // Check suppressions
  const lower = fingerprint.toLowerCase();
  for (const pat of _suppressed) {
    if (lower.includes(pat)) return;
  }
  const once = _onceSuppressed.get(ctx);
  if (once) {
    for (const pat of once) {
      if (lower.includes(pat)) return;
    }
  }

  // Count this fingerprint for the current request
  if (!_counts.has(ctx)) _counts.set(ctx, new Map());
  const map = _counts.get(ctx)!;
  const stats = map.get(fingerprint) ?? { count: 0, args: new Set<string>() };
  stats.count++;
  if (values !== undefined && stats.args.size < _ARG_SAMPLE_CAP) {
    stats.args.add(_argKey(values));
  }
  map.set(fingerprint, stats);

  if (stats.count >= _threshold) {
    // Only fire once (at exactly the threshold), not on every subsequent hit
    if (stats.count > _threshold) return;

    const err = new NPlusOneError(fingerprint, stats.count, stats.args.size);
    FrameworkEvents.emit(new NPlusOneDetected(fingerprint, stats.count, ctx ?? undefined));
    if (_mode === "throw") {
      throw err;
    } else {
      console.warn(`\n[Zerotal ORM] ${err.message}\n`);
    }
  }
}

/**
 * A comparable key for one call's bound parameters.
 *
 * Only ever compared against other keys for the same SQL shape, so it needs to
 * separate arguments rather than describe them. A value JSON cannot represent
 * degrades to its `String()` form, which is enough to tell two calls apart.
 */
function _argKey(values: readonly unknown[]): string {
  let key = "";
  for (const value of values) {
    if (value instanceof Date) key += `d${value.getTime()}|`;
    else if (value === null || value === undefined) key += "∅|";
    else if (typeof value === "object") key += `${_safeJson(value)}|`;
    else key += `${String(value)}|`;
  }
  return key;
}

function _safeJson(value: object): string {
  try {
    return JSON.stringify(value) ?? "?";
  } catch {
    return "?";
  }
}
