/**
 * Shared data shapes for the monitoring panel.
 *
 * These describe the *read model* — the aggregated snapshot the Flow page
 * renders. The recorder ({@link ../recorder/MonitorEventBridge.ts}) and the
 * live sources ({@link ../sources}) feed the {@link ../MonitorStore.ts}, which
 * derives a {@link MonitorSnapshot} on demand.
 */

import type { StorageInfo } from "./MonitorDb.ts";
export type { StorageInfo } from "./MonitorDb.ts";

/** Selectable time window for the dashboard. */
export type MonitorRange = "live" | "1h" | "24h" | "7d";

/** A coarse tone used to colour values across the UI. */
export type Tone = "ok" | "warn" | "bad" | "neutral";

// ── Overview ──────────────────────────────────────────────────────────────────

export interface StatCard {
  label: string;
  value: string;
  /** Percentage delta vs the previous window. */
  delta: number;
  /** Sparkline series (oldest → newest). */
  series: number[];
}

export interface Percentile {
  label: string; // p50 / p95 / p99
  value: number; // milliseconds
}

export interface RouteStat {
  method: string;
  path: string;
  ms: number;
}

/** Count of requests in one HTTP status class (Route detail). */
export interface StatusClassCount {
  label: "2xx" | "3xx" | "4xx" | "5xx";
  count: number;
}

/**
 * Aggregated latency / throughput / error history for a single route, powering
 * the per-route drill-in page. Derived on demand from `mon_requests` filtered to
 * one method+path within the selected window.
 */
export interface RouteDetail {
  method: string;
  path: string;
  range: MonitorRange;
  /** Total requests to this route in the window. */
  total: number;
  /** Requests per minute over the window. */
  rpm: number;
  /** Number of 5xx responses. */
  errorCount: number;
  /** 5xx responses as a percentage of total. */
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  maxMs: number;
  /** Request counts bucketed over the window (oldest → newest). */
  throughput: number[];
  /** Average latency (ms) bucketed over the window. */
  latency: number[];
  /** 5xx counts bucketed over the window. */
  errors: number[];
  /** Response breakdown by status class. */
  statusDist: StatusClassCount[];
  /** Most-recent requests to this route. */
  recent: RequestEntry[];
  /** Slowest requests to this route. */
  slowest: RequestEntry[];
}

export interface OutgoingHttp {
  host: string;
  calls: number;
  p95: number;
  errRate: number;
}

export interface Deploy {
  /** Seconds-into-window position used to place the marker (0..windowSeconds). */
  at: number;
  sha: string;
  when: string;
}

export interface Alert {
  tone: "red" | "amber";
  text: string;
}

/** Live "right now" gauges for the Overview pulse row — independent of the range tab. */
export interface PulseStats {
  /** HTTP requests currently being processed (in-flight concurrency). */
  activeRequests: number;
  /** Open Flow WebSocket connections. */
  activeConnections: number;
  /** Requests per second over the last 5 minutes. */
  requestsPerSec: number;
  /** 4xx+5xx rate over the last 5 minutes (%). */
  errorRatePct: number;
}

/** A snapshot of surrounding state captured when an alert fired — the "why". */
export interface AlertContext {
  errorRate: number;
  rpm: number;
  p50: number;
  p95: number;
  p99: number;
  apdex: number;
  pending: number;
  rolledBack: number;
  slowRoutes: RouteStat[];
  topException: string | null;
}

/** One alert kind, with its firings grouped and the latest firing's context. */
export interface AlertEntry {
  id: string;
  title: string;
  level: "warning" | "critical";
  status: "ok" | "warn" | "bad" | "info";
  detail: string;
  metric: string;
  value: number;
  threshold: number;
  unit: string;
  /** How many times this alert fired in the window. */
  count: number;
  firstSeen: string;
  lastSeen: string;
  context: AlertContext;
  /** Most-recent firings (newest first), for the timeline. */
  occurrences: { when: string; detail: string; value: number }[];
}

// ── Requests (trace explorer) ───────────────────────────────────────────────

export type SpanKind = "boot" | "middleware" | "controller" | "query" | "cache" | "http" | "view";

export interface RequestSpan {
  label: string;
  kind: SpanKind;
  start: number;
  dur: number;
}

export interface RequestQuery {
  ms: number;
  sql: string;
}

export interface RequestLog {
  level: "info" | "warn" | "error";
  msg: string;
}

/** Captured request/response headers + bodies (redacted), when payload capture is on. */
export interface RequestPayload {
  reqHeaders: Record<string, string>;
  reqBody: string;
  resBody: string;
}

export interface RequestEntry {
  id: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  when: string;
  nplus: boolean;
  /** Captured payload (headers + bodies), or null when capture is off / unavailable. */
  payload: RequestPayload | null;
  /** Authenticated user (id or email), or null when the request was unauthenticated. */
  user: string | null;
  /** Client IP address, or null when unavailable. */
  ip: string | null;
  /** Process heap (KB) at request completion — a per-request memory proxy. */
  memKb: number;
  /** Custom metadata attached via `Monitor.context(...)` during the request. */
  context: Record<string, unknown>;
  /** The exception message, when this request failed — links the request to its error. */
  error: string | null;
  spans: RequestSpan[];
  queries: RequestQuery[];
  logs: RequestLog[];
}

/** Top active users by request volume (Application Usage widget). */
export interface UserUsage {
  /** User id or email. */
  id: string;
  requests: number;
}

/** Heaviest routes by memory (Top Memory Requests widget). */
export interface MemoryRoute {
  method: string;
  path: string;
  /** Peak heap (KB) observed for this route in the window. */
  memKb: number;
  count: number;
}

// ── Exceptions ───────────────────────────────────────────────────────────────

export interface ExceptionGroup {
  type: string;
  message: string;
  location: string;
  count: number;
  users: number;
  lastSeen: string;
  d1: number;
  d7: number;
  d30: number;
  series: number[];
  frames: string[];
}

// ── Queues ───────────────────────────────────────────────────────────────────

export interface QueueMetric {
  label: string;
  value: string;
  sub: string;
  tone?: Tone;
}

export interface Worker {
  name: string;
  status: "running" | "paused" | "stopped";
  processes: number;
  jobsPerMin: number;
  series: number[];
}

export interface QueueRow {
  name: string;
  pending: number;
  wait: number;
  throughput: number;
  paused: boolean;
  series: number[];
}

export interface FailedJob {
  id: number;
  name: string;
  error: string;
  failedAt: string;
  attempts: number;
  tags: string[];
}

export interface ScheduledJob {
  name: string;
  runsIn: string;
  queue: string;
  tag: string;
}

export interface DeadJob {
  id: number;
  name: string;
  error: string;
  attempts: number;
  deadAt: string;
}

// ── Database ─────────────────────────────────────────────────────────────────

export interface DbStat {
  label: string;
  value: string;
  sub: string;
  tone?: Tone;
}

export interface SlowQuery {
  sql: string;
  ms: number;
  callers: number;
  location: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export interface CacheKey {
  key: string;
  hits: number;
  rate: number;
}

export interface CacheStats {
  hitRate: number;
  hits: number;
  misses: number;
  evictions: number;
  keys: CacheKey[];
}

// ── Framework-event feeds (security, scheduler, transactions, …) ───────────────

/** A single row in an event feed (security, scheduled-task runs, etc.). */
export interface FeedEvent {
  when: string;
  label: string;
  detail: string;
  status: "ok" | "warn" | "bad" | "info";
  route: string | null;
}

/** A failed or slow background job. */
export interface JobEntry {
  className: string;
  queue: string;
  status: string;
  ms: number;
  when: string;
  error: string | null;
}

/** An N+1 query offender (Database tab). */
export interface NPlusOne {
  fingerprint: string;
  occurrences: number;
  worstCount: number;
  route: string | null;
  lastSeen: string;
}

/** Database transaction summary. */
export interface TxStats {
  committed: number;
  rolledBack: number;
  avgMs: number;
}

/** A migration run (Database tab). */
export interface MigrationEntry {
  name: string;
  direction: string;
  ms: number;
  ok: boolean;
  when: string;
}

/** A single Flow WebSocket action with its request-scoped context. */
export interface WsAction {
  /** Stable id (the action's recorded timestamp) — keys the expandable row across pages. */
  id: number;
  component: string;
  action: string;
  ms: number;
  ok: boolean;
  user: string | null;
  ip: string | null;
  nplus: boolean;
  /** Process heap (KB) at action completion — the per-action memory proxy. */
  memKb: number;
  queries: RequestQuery[];
  context: Record<string, unknown>;
  when: string;
}

/** One currently-connected Flow WebSocket client. */
export interface ConnectedClient {
  id: string;
  ip: string;
  /** Authenticated user (email/id), or null if no action has identified them yet. */
  user: string | null;
  connectedFor: string;
  lastActivity: string;
  actions: number;
}

/** Realtime / Flow WebSocket activity. */
export interface RealtimeStats {
  activeConnections: number;
  actionsPerMin: number;
  avgActionMs: number;
  /** Average per-action heap (KB) across the window. */
  avgMemKb: number;
  opened: number;
  closed: number;
  series: number[];
  components: { name: string; actions: number; avgMs: number }[];
  slowActions: { component: string; action: string; ms: number; when: string }[];
  recentActions: WsAction[];
  /** Who is connected right now (live, not windowed). */
  clients: ConnectedClient[];
}

/** A delivered notification (one per channel), for the Notifications feed. */
export interface NotificationEntry {
  notification: string;
  channel: string;
  recipient: string;
  status: "ok" | "bad";
  ms: number;
  when: string;
}

/** A console/Artisan command run, for the Commands feed. */
export interface CommandEntry {
  name: string;
  status: "ok" | "bad";
  ms: number;
  code: number;
  when: string;
}

/** Per-model created/updated/deleted counts (the models watcher). */
export interface ModelStat {
  model: string;
  table: string;
  created: number;
  updated: number;
  deleted: number;
  total: number;
}

/** A single model-change event, for the recent-changes timeline. */
export interface ModelEvent {
  model: string;
  table: string;
  operation: "created" | "updated" | "deleted";
  when: string;
}

// ── Mail ─────────────────────────────────────────────────────────────────────

export interface MailEntry {
  id: number;
  subject: string;
  to: string;
  mailer: string;
  status: "sent" | "queued" | "failed";
  when: string;
  ms: number;
  body: string;
}

// ── System / health ──────────────────────────────────────────────────────────

export interface HealthEntry {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Gauge {
  label: string;
  value: number;
  sub: string;
}

export interface UptimeCheck {
  name: string;
  ok: boolean;
  ms: number;
  uptime: string;
}

export interface CheckIn {
  name: string;
  cron: string;
  last: string;
  status: "ok" | "late" | "missed";
}

export interface SystemMeta {
  uptime: string;
  bun: string;
  zerotal: string;
  region: string;
  deploy: string;
  /** Deployment environment (production / staging / development …). */
  environment: string;
}

// ── The full snapshot the page renders ──────────────────────────────────────

export interface MonitorSnapshot {
  range: MonitorRange;
  alerts: Alert[];
  deploys: Deploy[];

  // live pulse (in-flight requests, connections, rate, error rate) — not windowed
  pulse: PulseStats;

  // overview
  statCards: StatCard[];
  percentiles: Percentile[];
  apdex: number;
  throughput: number[];
  jobsSeries: number[];
  slowRoutes: RouteStat[];
  outgoingHttp: OutgoingHttp[];

  // queues
  queueStats: QueueMetric[];
  workers: Worker[];
  queues: QueueRow[];
  jobTags: string[];
  failedJobs: FailedJob[];
  scheduledJobs: ScheduledJob[];
  deadLetter: DeadJob[];

  // requests
  requests: RequestEntry[];
  slowRequests: RequestEntry[];
  topUsers: UserUsage[];
  topMemory: MemoryRoute[];

  // exceptions
  exceptions: ExceptionGroup[];

  // database
  dbStats: DbStat[];
  slowQueries: SlowQuery[];
  transactions: TxStats;
  migrations: MigrationEntry[];
  nplusOnes: NPlusOne[];

  // security / audit
  security: FeedEvent[];

  // threshold-alert history (firings grouped by kind, with captured context)
  alertHistory: AlertEntry[];

  // application logs
  logs: FeedEvent[];

  // realtime / websocket
  realtime: RealtimeStats;

  // scheduler run history + slow jobs
  scheduledRuns: FeedEvent[];
  slowJobs: JobEntry[];

  // cache
  cache: CacheStats;

  // mail
  mail: MailEntry[];

  // notifications (distinct from mail — one row per channel delivery)
  notifications: NotificationEntry[];

  // console / Artisan command runs
  commands: CommandEntry[];

  // ORM model-change counts (created/updated/deleted)
  models: ModelStat[];

  // ORM model-change timeline (most recent first)
  recentModels: ModelEvent[];

  // system
  health: HealthEntry[];
  gauges: Gauge[];
  uptimeChecks: UptimeCheck[];
  checkins: CheckIn[];
  storage: StorageInfo;
  meta: SystemMeta;
}
