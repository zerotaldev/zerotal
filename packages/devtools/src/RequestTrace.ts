export interface QuerySpan {
  sql: string;
  bindings: unknown[];
  startMs: number;
  durationMs: number;
  rowCount: number;
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
  /** Filtered request headers (no auth/cookie values) */
  headers: Record<string, string>;
  /** Matched route pattern, controller, and action */
  route: RouteInfo | null;
  /** Authenticated user at the end of the request, or null for guests */
  auth: AuthInfo | null;
  /** Console log/debug/info/warn/error messages emitted during the request */
  logs: LogEntry[];
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
