import type { SourceLocation } from "./editor.ts";

export interface QuerySpan {
  sql: string;
  bindings: unknown[];
  startMs: number;
  durationMs: number;
  rowCount: number;
  /**
   * The application line that ran this query, when one could be found.
   *
   * Absent for a query with no application frame above it — a seeder, a
   * framework-internal read — which is a truthful answer and better than
   * pointing at a file nobody wrote.
   */
  source?: SourceLocation;
}

export interface NPlusOneWarning {
  sql: string;
  count: number;
}

export interface RouteInfo {
  pattern: string;
  controller: string;
  action: string;
}

export interface AuthInfo {
  id: unknown;
  name?: unknown;
  email?: unknown;
}

export interface LogEntry {
  level: "log" | "debug" | "info" | "warn" | "error";
  args: string[];
  offsetMs: number;
  /** The application line that logged this, when one could be found. */
  source?: SourceLocation;
}

/**
 * The error that propagated out of the request pipeline, when one did.
 *
 * A failed request finalises like any other, so its status code was always on
 * the trace — but the message that caused it was not, and a red `500` with no
 * text next to it is the one thing a request inspector must not do.
 */
export interface ExceptionInfo {
  /** The error's message as it left the pipeline. */
  message: string;
  /** The status the rendered error response used. */
  status: number;
  /** The error's class name, when the failure was an `Error`. */
  type?: string;
  /**
   * The stack, innermost first, with framework frames kept.
   *
   * Unlike a query's call site this is deliberately *not* filtered to
   * application code: you read a stack trace to find out how you got somewhere,
   * and a trace with the middle removed does not tell you that.
   */
  frames?: SourceLocation[];
}

export interface MailEntry {
  /** Mailable class name (e.g. "WelcomeMail") */
  className: string;
  to: string[];
  subject: string;
  /** Rendered HTML — used for the mail preview panel */
  html: string;
  durationMs: number;
  queued: boolean;
  offsetMs: number;
}

export interface CacheEntry {
  op: "has" | "hit" | "miss" | "write" | "forget" | "flush";
  key: string;
  ttl?: number | undefined;
  durationMs: number;
  offsetMs: number;
}

export interface JobEntry {
  className: string;
  queue: string;
  status: "dispatched" | "completed" | "failed";
  durationMs: number;
  error?: string;
  offsetMs: number;
}

// ── Open channels ─────────────────────────────────────────────────────────────

/**
 * One entry on an open {@link TraceChannelDescriptor | channel}.
 *
 * The shape is deliberately a bare record: devtools does not know what a
 * channel carries, only how its descriptor says to display it. `offsetMs` is
 * stamped by devtools when the entry is recorded.
 */
export interface TraceChannelEntry extends Record<string, unknown> {
  /** Milliseconds from the start of the request. Stamped on record. */
  offsetMs: number;
}

/**
 * How a package's channel is displayed in the panel.
 *
 * The descriptor crosses the wire to the browser, so it names *fields* rather
 * than carrying formatter functions — a channel is declared once on the server
 * and rendered generically, which is what lets a package add a tab without
 * devtools shipping a renderer for it.
 *
 * @example
 * trace.channel({
 *   id: "auth",
 *   label: "Auth",
 *   badge: "event",
 *   title: "detail",
 *   meta: ["guard", "ip"],
 *   warn: "failed",
 * });
 */
export interface TraceChannelDescriptor {
  /** Unique id — also the key under {@link RequestTrace.channels}. */
  id: string;
  /** Tab label in the panel. */
  label: string;
  /** Entry field rendered as the row's leading badge. */
  badge?: string;
  /** Entry field rendered as the row's main text. Defaults to the badge field. */
  title?: string;
  /** Entry fields rendered as dim metadata beneath the title. */
  meta?: string[];
  /** Entry field whose truthiness marks the row — and the tab's badge — as a warning. */
  warn?: string;
  /** Sort order among channel tabs. Lower sorts first. Defaults to 100. */
  order?: number;

  // ── Presentation hints ──────────────────────────────────────────────────────
  //
  // A flat list of badge-title-meta rows is the right shape for an audit feed and
  // the wrong one for a prop map or a route table. These pick a different
  // presentation without breaking the property that makes channels worth having:
  // everything here is still *data*, so devtools ships no code per package.

  /**
   * How rows are presented. Defaults to `"rows"` — badge, title, and a meta line.
   *
   * - `"rows"` — one block per entry.
   * - `"tree"` — {@link treeField} holds a map of dotted paths; shared prefixes
   *   become branches.
   * - `"table"` — one row per entry, {@link meta} as columns. For many entries
   *   with the same shape.
   * - `"kv"` — every field of every entry as a key/value table. For a handful of
   *   entries with many fields.
   * - `"grouped"` — entries collected under the value of {@link groupBy}.
   */
  render?: "rows" | "tree" | "table" | "kv" | "grouped";
  /**
   * For `"tree"`: the entry field holding the tree, as a map of dotted path →
   * a record of that node's attributes. Dotted keys become branches.
   */
  treeField?: string;
  /** For `"tree"`: the node field rendered as each leaf's leading badge. */
  treeBadge?: string;
  /** For `"grouped"`: the entry field rows are grouped by. */
  groupBy?: string;
  /**
   * Fields rendered as a bare chip when truthy — `shared`, `deferred`, `failed`.
   * Applies to a row's own fields and, under `"tree"`, to each node's.
   *
   * A flag is named by its *field*, so a `true` reads as the word rather than as
   * `deepMerge: true`, which is how a row ends up saying nothing at a glance.
   */
  flags?: string[];
  /**
   * The entry field whose value groups whole *traces* together on the All tab.
   *
   * One request can cause several — a visit and the deferred-prop loads it
   * triggers — and listing them as unrelated siblings is how the thing you are
   * debugging scrolls away. Traces sharing a value here collapse into one
   * expandable entry. Read from the channel's first entry on each trace.
   */
  traceGroup?: string;
}

export interface RequestTrace {
  id: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  startMs: number;
  durationMs: number;
  queries: QuerySpan[];
  warnings: NPlusOneWarning[];
  /** Heap memory used at the end of the request, in bytes */
  memory: number;
  /** URL query string parameters */
  queryParams: Record<string, string>;
  /** Filtered request headers (never auth/cookie values) */
  headers: Record<string, string>;
  /** Filtered response headers — the other half of the exchange */
  responseHeaders: Record<string, string>;
  /**
   * Session key names, never values.
   *
   * "Is the CSRF token there, did the flash survive the redirect, is the user id
   * set" are all answered by the keys — and the values are the request's real
   * state, on a trace that is written to disk for a day.
   */
  session: string[];
  /** Matched route pattern, controller, and action */
  route: RouteInfo | null;
  /** Authenticated user at the end of the request, or null for guests */
  auth: AuthInfo | null;
  /** Console log/debug/info/warn/error messages emitted during the request */
  logs: LogEntry[];
  /** The error that ended the request, or null when it completed normally */
  exception: ExceptionInfo | null;
  /** Emails sent (or queued) during this request */
  mail: MailEntry[];
  /** Cache operations performed during this request */
  cache: CacheEntry[];
  /** Jobs dispatched (or processed synchronously) during this request */
  jobs: JobEntry[];
  /**
   * Entries recorded on open channels, keyed by channel id.
   *
   * The fields above are the five signals devtools renders with bespoke UI they
   * have earned — a query needs its bindings and duration bar, mail needs its
   * preview. Everything else a package wants to show lands here and is rendered
   * from its {@link TraceChannelDescriptor}, so contributing a tab takes no
   * change inside devtools.
   */
  channels: Record<string, TraceChannelEntry[]>;
}
