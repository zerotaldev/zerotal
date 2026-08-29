/**
 * The monitoring panel's aggregation store, backed by SQLite
 * ({@link ./store/MonitorDb.ts}).
 *
 * Raw events are appended to the database with timestamps via the `record*`
 * methods. `snapshot(range)` reads the rows within the selected window and
 * derives a {@link MonitorSnapshot} — percentiles, throughput, slow routes,
 * exception groups, cache and outgoing-HTTP stats. Because everything is
 * persisted, the live / 1h / 24h / 7d ranges all trace real history and survive
 * restarts. There is no sample data: a quiet window reads as honest zeros.
 *
 * A retention policy (`prune`) deletes or archives data past the configured
 * window, and `wipe` clears everything on demand from the panel.
 */
import type { Resolved } from "@zerotal/core";
import { percentile } from "./store/RingBuffer.ts";
import { MonitorDb } from "./store/MonitorDb.ts";
import {
  bufferQuery as _bufferQuery,
  markNPlus as _markNPlus,
  collectRequestState as _collectRequestState,
} from "./recorder/ctxBuffers.ts";
import type { RequestState } from "./recorder/ctxBuffers.ts";
import type {
  RetentionMode,
  StorageInfo,
  RequestRow,
  QueryRow,
  ExceptionRow,
  HttpRow,
  CacheRow,
  MailRow,
  DeployRow,
  JobRow,
  EventRow,
} from "./store/MonitorDb.ts";
import type {
  Alert,
  AlertContext,
  AlertEntry,
  CacheStats,
  CommandEntry,
  ConnectedClient,
  DbStat,
  Deploy,
  ExceptionGroup,
  FeedEvent,
  HealthEntry,
  JobEntry,
  MailEntry,
  MemoryRoute,
  MigrationEntry,
  ModelEvent,
  ModelStat,
  MonitorRange,
  MonitorSnapshot,
  NotificationEntry,
  NPlusOne,
  OutgoingHttp,
  Percentile,
  PulseStats,
  QueueMetric,
  QueueRow,
  RealtimeStats,
  RequestEntry,
  RequestPayload,
  RequestQuery,
  RequestSpan,
  RouteDetail,
  RouteStat,
  SlowQuery,
  StatCard,
  StatusClassCount,
  TxStats,
  UptimeCheck,
  UserUsage,
  Worker,
} from "./store/types.ts";
import { activeConnections, connectedClients } from "./sources/realtime.ts";
import { ago, commas, delta } from "./support/time.ts";
import {
  liveCheckins,
  liveDeadLetter,
  liveFailedJobs,
  liveHealth,
  liveQueues,
  liveQueueStats,
  liveScheduled,
  liveWorkers,
  type AppShape,
} from "./sources/live.ts";
import { systemGauges, systemMeta, httpPulse } from "./sources/system.ts";

interface ReqSample {
  t: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  queries: RequestQuery[];
  nplus: boolean;
  user: string | null;
  ip: string | null;
  mem: number;
  context: Record<string, unknown>;
  payload: RequestPayload | null;
  error: string | null;
}

export interface MonitorStoreOptions {
  apdexTargetMs?: number | undefined;
  slowQueryMs?: number | undefined;
  zerotalVersion?: string | undefined;
  region?: string | undefined;
  deploy?: string | undefined;
  /** SQLite path. `:memory:` (default) for tests; a file path for persistence. */
  storage?: string | undefined;
  /** Days of history to keep before pruning. Default: 7. */
  retentionDays?: number | undefined;
  /** What to do with data past retention: delete it or move it to the archive. Default: `delete`. */
  retentionMode?: RetentionMode | undefined;
  /** Requests at/above this many ms count as "slow". Default: 1000. */
  slowRequestMs?: number | undefined;
  /**
   * Cache built snapshots for this many ms, keyed by range. De-dupes overlapping
   * builds (panel poll + Prometheus scrape + alert loop all hit "live"). Mutating
   * actions invalidate it. Default: 0 (off) — the provider enables it in production.
   */
  snapshotCacheMs?: number | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class MonitorStore {
  private readonly _db: MonitorDb;
  private _app?: AppShape;
  private readonly _pausedQueues = new Set<string>();
  private readonly _removedFailed = new Set<number>();
  private readonly _removedDead = new Set<number>();
  private readonly _snapTtlMs: number;
  private readonly _snapCache = new Map<MonitorRange, { at: number; snap: MonitorSnapshot }>();

  private readonly _opts: Resolved<
    Pick<
      MonitorStoreOptions,
      "apdexTargetMs" | "slowQueryMs" | "slowRequestMs" | "retentionDays" | "retentionMode"
    >
  > &
    Omit<
      MonitorStoreOptions,
      "apdexTargetMs" | "slowQueryMs" | "slowRequestMs" | "retentionDays" | "retentionMode"
    >;

  constructor(opts: MonitorStoreOptions = {}) {
    // The caller's options go FIRST, then the defaults fill the gaps — the same
    // ordering, for the same reason, as `Socket`'s constructor documents at length.
    // Object spread copies own properties even when their value is `undefined`, so
    // `new MonitorStore({ retentionDays: cfg.retentionDays })` with an unset config
    // put `undefined` straight back over the 7 and `prune()` then computed a cutoff
    // of `Date.now() - undefined * DAY_MS` — NaN, which deletes nothing and reports
    // nothing. Spreading last is what made the `??` above decorative.
    this._opts = {
      ...opts,
      apdexTargetMs: opts.apdexTargetMs ?? 100,
      slowQueryMs: opts.slowQueryMs ?? 100,
      slowRequestMs: opts.slowRequestMs ?? 1000,
      retentionDays: opts.retentionDays ?? 7,
      retentionMode: opts.retentionMode ?? "delete",
    };
    this._snapTtlMs = Math.max(0, opts.snapshotCacheMs ?? 0);
    this._db = new MonitorDb(opts.storage ?? ":memory:");
  }

  /** Bind the IoC app so live sources (queue/scheduler/health) can be read. */
  bindApp(app: AppShape): void {
    this._app = app;
  }

  // ── Ingestion ──────────────────────────────────────────────────────────────

  recordRequest(r: {
    method: string;
    path: string;
    status: number;
    ms: number;
    queries?: RequestQuery[];
    logs?: unknown;
    nplus?: boolean;
    spans?: unknown;
    user?: string | null;
    ip?: string | null;
    memKb?: number;
    context?: Record<string, unknown>;
    payload?: RequestPayload | null;
    error?: string | null;
  }): void {
    const queries = r.queries ?? [];
    const ms = Math.max(0, Math.round(r.ms));
    this._db.recordRequest({
      t: Date.now(),
      method: r.method.toUpperCase(),
      path: r.path,
      status: r.status,
      ms,
      nplus: (r.nplus ?? queries.length > 25) ? 1 : 0,
      queries: JSON.stringify(queries),
      user: r.user ?? null,
      ip: r.ip ?? null,
      mem: Math.max(0, Math.round(r.memKb ?? 0)),
      context: JSON.stringify(r.context ?? {}),
      payload: r.payload ? JSON.stringify(r.payload) : null,
      error: r.error ?? null,
    });
  }

  recordException(
    error: Error | { type: string; message: string },
    location?: string,
    user?: string | null,
  ): void {
    const type =
      "type" in error && typeof error.type === "string"
        ? error.type
        : (error as Error).name || "Error";
    const message = error.message ?? "";
    const frames = this._stackFrames((error as Error).stack);
    const loc = location ?? frames[0] ?? "unknown";
    this._db.recordException({
      t: Date.now(),
      type,
      message,
      location: loc,
      frames: JSON.stringify(frames),
      user: user ?? null,
    });
  }

  recordQuery(q: { sql: string; ms: number; location?: string }): void {
    this._db.recordQuery({
      t: Date.now(),
      sql: q.sql,
      ms: Math.round(q.ms),
      location: q.location ?? "—",
    });
  }

  recordHttp(h: { host: string; ms: number; error?: boolean }): void {
    this._db.recordHttp({
      t: Date.now(),
      host: h.host,
      ms: Math.round(h.ms),
      error: h.error ? 1 : 0,
    });
  }

  recordCache(hit: boolean, key?: string): void {
    this._db.recordCache({ t: Date.now(), hit: hit ? 1 : 0, key: key ?? "" });
  }

  recordMail(m: Omit<MailEntry, "id" | "when"> & { when?: string }): void {
    this._db.recordMail({
      t: Date.now(),
      subject: m.subject,
      recipient: m.to,
      mailer: m.mailer,
      status: m.status,
      ms: m.ms,
      body: m.body,
    });
  }

  recordDeploy(sha: string): void {
    this._db.recordDeploy({ t: Date.now(), sha: sha.slice(0, 7) });
  }

  recordJob(job: {
    status: string;
    className?: string;
    queue?: string;
    ms?: number;
    error?: string | null;
  }): void {
    this._db.recordJob({
      t: Date.now(),
      status: job.status,
      className: job.className ?? "",
      queue: job.queue ?? "default",
      ms: Math.max(0, Math.round(job.ms ?? 0)),
      error: job.error ?? null,
    });
  }

  /** Record a generic framework event (security, transaction, migration, N+1, WS, …). */
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void {
    this._db.recordEvent({
      t: Date.now(),
      kind: e.kind,
      label: e.label,
      status: e.status ?? "info",
      route: e.route ?? null,
      data: JSON.stringify(e.data ?? {}),
    });
  }

  // ── Per-request correlation (contributed by feature packages) ──────────────────
  // Feature packages hold only this store (resolved from the container), so these
  // thin methods expose the shared request buffers: a package buffers its per-request
  // signal while the request is in flight, and the request-lifecycle handler drains
  // it on finalise. See recorder/ctxBuffers.ts.

  /** Buffer one query span against the request context it ran under. */
  bufferQuery(ctx: object, q: RequestQuery): void {
    _bufferQuery(ctx, q);
  }

  /** Flag the request context as having triggered an N+1 pattern. */
  markNPlus(ctx: object): void {
    _markNPlus(ctx);
  }

  /** Read and clear the buffered correlation state for a finalised request/action. */
  collectRequestState(ctx: object): RequestState {
    return _collectRequestState(ctx);
  }

  // ── UI actions ────────────────────────────────────────────────────────────────

  /** Toggle a queue's paused state. Returns the new paused state. */
  toggleQueuePaused(name: string): boolean {
    this._invalidate();
    if (this._pausedQueues.has(name)) {
      this._pausedQueues.delete(name);
      return false;
    }
    this._pausedQueues.add(name);
    return true;
  }

  /** Retry a failed job (real if a queue is bound) and drop it from the list. */
  async retryFailed(id: number): Promise<boolean> {
    this._invalidate();
    this._removedFailed.add(id);
    const { retryFailedJob } = await import("./sources/live.ts");
    return retryFailedJob(this._app, id);
  }

  /** Permanently forget a failed job. */
  async forgetFailed(id: number): Promise<boolean> {
    this._invalidate();
    this._removedFailed.add(id);
    const { forgetFailedJob } = await import("./sources/live.ts");
    return forgetFailedJob(this._app, id);
  }

  /** Requeue a dead-letter job: re-dispatch it (if a queue is bound) and drop it from the view. */
  async requeueDead(id: number): Promise<boolean> {
    this._invalidate();
    this._removedDead.add(id);
    const { retryFailedJob } = await import("./sources/live.ts");
    return retryFailedJob(this._app, id);
  }

  // ── Retention / cleanup ──────────────────────────────────────────────────────

  /** Prune data older than the retention window (delete or archive). Returns rows removed. */
  prune(): number {
    this._invalidate();
    const cutoff = Date.now() - this._opts.retentionDays * DAY_MS;
    return this._db.prune(cutoff, this._opts.retentionMode);
  }

  /** Wipe all recorded data. Returns rows removed. */
  wipe(): number {
    this._invalidate();
    return this._db.wipe();
  }

  storageInfo(): StorageInfo {
    return this._db.info();
  }
  retentionDays(): number {
    return this._opts.retentionDays;
  }
  retentionMode(): RetentionMode {
    return this._opts.retentionMode;
  }

  dispose(): void {
    this._db.dispose();
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  async snapshot(range: MonitorRange = "live"): Promise<MonitorSnapshot> {
    if (this._snapTtlMs > 0) {
      const cached = this._snapCache.get(range);
      if (cached && Date.now() - cached.at < this._snapTtlMs) return cached.snap;
    }
    const snap = await this._buildSnapshot(range);
    if (this._snapTtlMs > 0) this._snapCache.set(range, { at: Date.now(), snap });
    return snap;
  }

  /** Clear any cached snapshots so the next read reflects a just-applied change. */
  private _invalidate(): void {
    this._snapCache.clear();
  }

  private async _buildSnapshot(range: MonitorRange = "live"): Promise<MonitorSnapshot> {
    this._db.flush(); // drain the write buffer so the snapshot sees the latest activity
    const windowMs = this._rangeMs(range);
    const now = Date.now();
    const cutoff = now - windowMs;

    const reqs = this._db.requestsWithin(cutoff).map((r) => this._toSample(r));
    const priorReqs = this._db
      .requestsBetween(now - windowMs * 2, cutoff)
      .map((r) => this._toSample(r));
    const queryRows = this._db.queriesWithin(cutoff);
    const excRows = this._db.exceptionsWithin(cutoff);
    const httpRows = this._db.httpWithin(cutoff);
    const cacheRows = this._db.cacheWithin(cutoff);
    const mailRows = this._db.mailWithin(cutoff);
    const jobRows = this._db.jobsWithin(cutoff);
    const deployRows = this._db.deploysWithin(cutoff);
    const eventRows = this._db.eventsWithin(cutoff);

    // Live sources return null when the peer/subsystem isn't installed → empty,
    // never fabricated sample data.
    const liveQ = await liveQueues(this._app);
    const queues: QueueRow[] = (liveQ ?? []).map((q) => ({
      ...q,
      paused: this._pausedQueues.has(q.name) || q.paused,
    }));
    // Real throughput + trend per queue, derived from the job runs the monitor records
    // (the queue manager only reports pending depth; wait time has no source, stays 0).
    this._enrichQueues(queues, jobRows, windowMs);
    const failedJobs = ((await liveFailedJobs(this._app)) ?? []).filter(
      (j) => !this._removedFailed.has(j.id),
    );
    const deadLetter = ((await liveDeadLetter(this._app)) ?? []).filter(
      (d) => !this._removedDead.has(d.id),
    );
    const workers: Worker[] = liveWorkers(this._app) ?? [];
    const scheduledJobs = liveScheduled(this._app) ?? [];
    const checkins = liveCheckins(this._app) ?? [];
    const health = (await liveHealth(this._app)) ?? [];

    return {
      range,
      alerts: this._alerts(reqs, queues),
      deploys: this._deployMarkers(deployRows),
      pulse: this._pulse(),
      statCards: this._statCards(reqs, priorReqs, windowMs, cacheRows),
      percentiles: this._percentiles(reqs),
      apdex: this._apdex(reqs),
      throughput: this._bucket(reqs, 60, () => 1),
      jobsSeries: this._jobSeries(jobRows, windowMs),
      slowRoutes: this._slowRoutes(reqs),
      outgoingHttp: this._outgoing(httpRows),
      queueStats: this._queueStats(queues, failedJobs),
      workers,
      queues,
      jobTags: this._jobTags(failedJobs),
      failedJobs,
      scheduledJobs,
      deadLetter,
      requests: this._recentRequests(reqs),
      slowRequests: this._slowRequests(reqs),
      topUsers: this._topUsers(reqs),
      topMemory: this._topMemory(reqs),
      exceptions: this._exceptionGroups(excRows),
      dbStats: this._dbStats(queryRows, windowMs),
      slowQueries: this._slowQueries(queryRows),
      transactions: this._transactions(eventRows),
      migrations: this._migrations(eventRows),
      nplusOnes: this._nplusOnes(eventRows),
      security: this._feed(eventRows, "auth", 50),
      alertHistory: this._alertEntries(eventRows),
      logs: this._feed(eventRows, "log", 100),
      realtime: this._realtime(eventRows, windowMs),
      scheduledRuns: this._feed(eventRows, "task", 30),
      slowJobs: this._slowJobs(jobRows),
      cache: this._cache(cacheRows, eventRows),
      mail: this._mailEntries(mailRows),
      notifications: this._notifications(eventRows),
      commands: this._commands(eventRows),
      models: this._models(eventRows),
      recentModels: this._recentModels(eventRows),
      health,
      gauges: systemGauges(),
      uptimeChecks: this._uptimeChecks(health),
      checkins,
      storage: this._db.info(),
      meta: systemMeta({
        ...(this._opts.zerotalVersion ? { zerotal: this._opts.zerotalVersion } : {}),
        ...(this._opts.region ? { region: this._opts.region } : {}),
        ...(this._opts.deploy ? { deploy: this._opts.deploy } : {}),
      }),
    };
  }

  /**
   * Drill into a single route: latency percentiles, throughput/latency/error
   * series, status-class breakdown, and the recent + slowest requests — all from
   * `mon_requests` filtered to one method+path within the window.
   */
  async routeDetail(
    method: string,
    path: string,
    range: MonitorRange = "live",
  ): Promise<RouteDetail> {
    this._db.flush();
    const windowMs = this._rangeMs(range);
    const cutoff = Date.now() - windowMs;
    const reqs = this._db
      .requestsForRouteWithin(method.toUpperCase(), path, cutoff)
      .map((r) => this._toSample(r));

    const ms = reqs.map((r) => r.ms);
    const errorCount = reqs.filter((r) => r.status >= 500).length;
    const minutes = Math.max(1, windowMs / 60000);

    const classes: Record<StatusClassCount["label"], number> = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
    };
    for (const r of reqs) {
      const cls = `${Math.floor(r.status / 100)}xx` as StatusClassCount["label"];
      if (cls in classes) classes[cls]++;
    }
    const statusDist: StatusClassCount[] = (["2xx", "3xx", "4xx", "5xx"] as const)
      .map((label) => ({ label, count: classes[label] }))
      .filter((c) => c.count > 0);

    return {
      method: method.toUpperCase(),
      path,
      range,
      total: reqs.length,
      rpm: Math.round((reqs.length / minutes) * 10) / 10,
      errorCount,
      errorRate: reqs.length ? +((errorCount / reqs.length) * 100).toFixed(1) : 0,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      p99: percentile(ms, 99),
      avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0,
      maxMs: ms.length ? Math.max(...ms) : 0,
      throughput: this._bucket(reqs, 60, () => 1),
      latency: this._bucket(reqs, 60, (r) => r.ms, true),
      errors: this._bucket(reqs, 60, (r) => (r.status >= 500 ? 1 : 0)),
      statusDist,
      recent: [...reqs]
        .sort((a, b) => b.t - a.t)
        .slice(0, 10)
        .map((r) => this._toEntry(r)),
      slowest: [...reqs]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 10)
        .map((r) => this._toEntry(r)),
    };
  }

  private _toSample(r: RequestRow): ReqSample {
    return {
      t: r.t,
      method: r.method,
      path: r.path,
      status: r.status,
      ms: r.ms,
      queries: this._parseQueries(r.queries),
      nplus: r.nplus === 1,
      user: r.user ?? null,
      ip: r.ip ?? null,
      mem: r.mem ?? 0,
      context: this._parseContext(r.context),
      payload: this._parsePayload(r.payload),
      error: r.error ?? null,
    };
  }

  private _parsePayload(json: string | null | undefined): RequestPayload | null {
    if (!json) return null;
    try {
      const v = JSON.parse(json);
      return v && typeof v === "object" ? (v as RequestPayload) : null;
    } catch {
      return null;
    }
  }

  private _parseContext(json: string | undefined): Record<string, unknown> {
    if (!json) return {};
    try {
      const v = JSON.parse(json);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Live "right now" gauges for the Overview pulse row (in-flight, connections, rate). */
  private _pulse(): PulseStats {
    const p = httpPulse();
    return {
      activeRequests: p.activeRequests,
      activeConnections: activeConnections(),
      requestsPerSec: p.requestsPerSec,
      errorRatePct: p.errorRatePct,
    };
  }

  private _deployMarkers(rows: DeployRow[]): Deploy[] {
    if (rows.length > 0) {
      return rows.map((d, i) => ({ at: 12 + i * 18, sha: d.sha.slice(0, 7), when: ago(d.t) }));
    }
    if (this._opts.deploy) return [{ at: 50, sha: this._opts.deploy.slice(0, 7), when: "current" }];
    return [];
  }

  private _uptimeChecks(health: HealthEntry[]): UptimeCheck[] {
    return health.map((h) => ({
      name: h.name,
      ok: h.ok,
      ms: 0,
      uptime: h.ok ? "operational" : "down",
    }));
  }

  // ── Derivations ──────────────────────────────────────────────────────────────

  private _statCards(
    reqs: ReqSample[],
    priorReqs: ReqSample[],
    windowMs: number,
    cacheRows: CacheRow[],
  ): StatCard[] {
    const minutes = Math.max(1, windowMs / 60000);
    const rpm = reqs.length / minutes;
    const avg = reqs.length ? reqs.reduce((a, r) => a + r.ms, 0) / reqs.length : 0;
    const errs = reqs.filter((r) => r.status >= 500).length;
    const errRate = reqs.length ? (errs / reqs.length) * 100 : 0;
    const cHits = cacheRows.filter((c) => c.hit).length;
    const cacheRate = cacheRows.length ? (cHits / cacheRows.length) * 100 : 0;

    const priorAvg = priorReqs.length
      ? priorReqs.reduce((a, r) => a + r.ms, 0) / priorReqs.length
      : avg;
    const priorRpm = priorReqs.length / minutes;

    return [
      {
        label: "Requests / min",
        value: commas(rpm),
        delta: delta(rpm, priorRpm || rpm),
        series: this._bucket(reqs, 20, () => 1),
      },
      {
        label: "Avg response",
        value: `${Math.round(avg)}ms`,
        delta: delta(avg, priorAvg),
        series: this._bucket(reqs, 20, (r) => r.ms, true),
      },
      {
        label: "Error rate",
        value: `${errRate.toFixed(1)}%`,
        delta: 0,
        series: this._bucket(reqs, 20, (r) => (r.status >= 500 ? 1 : 0)),
      },
      {
        label: "Cache hit rate",
        value: `${cacheRate.toFixed(1)}%`,
        delta: 0,
        series: Array.from({ length: 20 }, () => Math.round(cacheRate)),
      },
    ];
  }

  private _percentiles(reqs: ReqSample[]): Percentile[] {
    const ms = reqs.map((r) => r.ms);
    return [
      { label: "p50", value: percentile(ms, 50) },
      { label: "p95", value: percentile(ms, 95) },
      { label: "p99", value: percentile(ms, 99) },
    ];
  }

  /** Apdex = (satisfied + tolerating/2) / total, with T = apdexTargetMs. */
  private _apdex(reqs: ReqSample[]): number {
    if (reqs.length === 0) return 1;
    const T = this._opts.apdexTargetMs;
    let satisfied = 0;
    let tolerating = 0;
    for (const r of reqs) {
      if (r.ms <= T) satisfied++;
      else if (r.ms <= 4 * T) tolerating++;
    }
    return +((satisfied + tolerating / 2) / reqs.length).toFixed(2);
  }

  private _slowRoutes(reqs: ReqSample[]): RouteStat[] {
    const byRoute = new Map<string, { method: string; path: string; total: number; n: number }>();
    for (const r of reqs) {
      const key = `${r.method} ${r.path}`;
      const e = byRoute.get(key) ?? { method: r.method, path: r.path, total: 0, n: 0 };
      e.total += r.ms;
      e.n++;
      byRoute.set(key, e);
    }
    return [...byRoute.values()]
      .map((e) => ({ method: e.method, path: e.path, ms: Math.round(e.total / e.n) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);
  }

  private _outgoing(rows: HttpRow[]): OutgoingHttp[] {
    const byHost = new Map<string, { calls: number; durations: number[]; errors: number }>();
    for (const r of rows) {
      const e = byHost.get(r.host) ?? { calls: 0, durations: [], errors: 0 };
      e.calls++;
      e.durations.push(r.ms);
      if (r.error) e.errors++;
      byHost.set(r.host, e);
    }
    return [...byHost.entries()]
      .map(([host, e]) => ({
        host,
        calls: e.calls,
        p95: percentile(e.durations, 95),
        errRate: +((e.errors / Math.max(1, e.calls)) * 100).toFixed(1),
      }))
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 8);
  }

  private _toEntry(r: ReqSample): RequestEntry {
    return {
      id: r.t,
      method: r.method,
      path: r.path,
      status: r.status,
      ms: r.ms,
      when: ago(r.t),
      nplus: r.nplus,
      user: r.user,
      ip: r.ip,
      memKb: r.mem,
      context: r.context,
      payload: r.payload,
      error: r.error,
      spans: this._synthSpans(r.ms, r.queries),
      queries: r.queries,
      logs: [],
    };
  }

  private _recentRequests(reqs: ReqSample[]): RequestEntry[] {
    return [...reqs]
      .sort((a, b) => b.t - a.t)
      .slice(0, 50) // the table paginates this client-side, 10 per page
      .map((r) => this._toEntry(r));
  }

  /** Requests at/above the slow threshold, slowest first. */
  private _slowRequests(reqs: ReqSample[]): RequestEntry[] {
    return reqs
      .filter((r) => r.ms >= this._opts.slowRequestMs)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10)
      .map((r) => this._toEntry(r));
  }

  /** Top active users by request volume (Application Usage). */
  private _topUsers(reqs: ReqSample[]): UserUsage[] {
    const counts = new Map<string, number>();
    for (const r of reqs) {
      if (r.user) counts.set(r.user, (counts.get(r.user) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, requests]) => ({ id, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }

  /** Heaviest routes by peak memory (Top Memory Requests). */
  private _topMemory(reqs: ReqSample[]): MemoryRoute[] {
    const byRoute = new Map<string, MemoryRoute>();
    for (const r of reqs) {
      if (r.mem <= 0) continue;
      const key = `${r.method} ${r.path}`;
      const e = byRoute.get(key) ?? { method: r.method, path: r.path, memKb: 0, count: 0 };
      e.memKb = Math.max(e.memKb, r.mem);
      e.count++;
      byRoute.set(key, e);
    }
    return [...byRoute.values()].sort((a, b) => b.memKb - a.memKb).slice(0, 8);
  }

  private _exceptionGroups(rows: ExceptionRow[]): ExceptionGroup[] {
    const now = Date.now();
    const groups = new Map<string, ExceptionRow[]>();
    for (const r of rows) {
      const key = `${r.type}:${r.location}`;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(r);
    }

    const out: ExceptionGroup[] = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.t - b.t);
      const last = list[list.length - 1]!;
      const within = (ms: number): number => list.filter((r) => r.t >= now - ms).length;
      // Distinct authenticated users who hit this exception (anonymous hits excluded).
      const affectedUsers = new Set(list.map((r) => r.user).filter((u): u is string => !!u));

      // 24 hourly buckets over the last 24h (oldest → newest).
      const buckets = Array.from({ length: 24 }, () => 0);
      for (const r of list) {
        const hoursAgo = (now - r.t) / (60 * 60 * 1000);
        if (hoursAgo >= 0 && hoursAgo < 24) {
          const idx = 23 - Math.floor(hoursAgo);
          if (idx >= 0 && idx < 24) buckets[idx] = (buckets[idx] ?? 0) + 1;
        }
      }

      out.push({
        type: last.type,
        message: last.message,
        location: last.location,
        count: list.length,
        users: affectedUsers.size,
        lastSeen: ago(last.t).replace(" ago", ""),
        d1: within(DAY_MS),
        d7: within(7 * DAY_MS),
        d30: within(30 * DAY_MS),
        series: buckets,
        frames: this._parseFrames(last.frames),
      });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  private _slowQueries(rows: QueryRow[]): SlowQuery[] {
    const bySql = new Map<string, { sql: string; total: number; n: number; location: string }>();
    for (const q of rows) {
      const e = bySql.get(q.sql) ?? { sql: q.sql, total: 0, n: 0, location: q.location };
      e.total += q.ms;
      e.n++;
      bySql.set(q.sql, e);
    }
    return [...bySql.values()]
      .map((e) => ({
        sql: e.sql,
        ms: Math.round(e.total / e.n),
        callers: e.n,
        location: e.location,
      }))
      .filter((e) => e.ms >= this._opts.slowQueryMs)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10);
  }

  private _cache(rows: CacheRow[], events: EventRow[]): CacheStats {
    let hits = 0;
    let misses = 0;
    const keys = new Map<string, { hits: number; total: number }>();
    for (const r of rows) {
      if (r.hit) hits++;
      else misses++;
      if (r.key) {
        const k = keys.get(r.key) ?? { hits: 0, total: 0 };
        k.total++;
        if (r.hit) k.hits++;
        keys.set(r.key, k);
      }
    }
    const total = hits + misses;
    const keyList = [...keys.entries()]
      .map(([key, v]) => ({
        key,
        hits: v.hits,
        rate: Math.round((v.hits / Math.max(1, v.total)) * 100),
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 8);
    const evictions = events.filter((e) => e.kind === "cache_evict").length;
    return {
      hitRate: total > 0 ? Math.round((hits / total) * 100) : 0,
      hits,
      misses,
      evictions,
      keys: keyList,
    };
  }

  // ── Framework-event feeds ──────────────────────────────────────────────────

  private _eventData(row: EventRow): Record<string, unknown> {
    try {
      const v = JSON.parse(row.data);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** A generic event feed (security, scheduled-task runs, …). */
  private _feed(rows: EventRow[], kind: string, limit: number): FeedEvent[] {
    return rows
      .filter((r) => r.kind === kind)
      .slice(0, limit)
      .map((r) => {
        const d = this._eventData(r);
        const detail =
          typeof d.detail === "string"
            ? d.detail
            : d.ms != null
              ? `${Math.round(Number(d.ms))}ms`
              : d.count != null
                ? `×${d.count}`
                : "";
        return {
          when: ago(r.t).replace(" ago", ""),
          label: r.label,
          detail,
          status: (r.status as FeedEvent["status"]) ?? "info",
          route: r.route,
        };
      });
  }

  /** Group persisted alert firings by kind, keeping a count, a timeline, and the latest firing's context. */
  private _alertEntries(rows: EventRow[]): AlertEntry[] {
    interface G {
      id: string;
      title: string;
      latest: EventRow;
      firstT: number;
      lastT: number;
      count: number;
      occurrences: { when: string; detail: string; value: number }[];
    }
    const groups = new Map<string, G>();
    // Rows arrive newest-first (eventsWithin orders by t DESC).
    for (const r of rows) {
      if (r.kind !== "alert") continue;
      const d = this._eventData(r);
      const id = String(d.id ?? r.route ?? r.label);
      let g = groups.get(id);
      if (!g) {
        g = { id, title: r.label, latest: r, firstT: r.t, lastT: r.t, count: 0, occurrences: [] };
        groups.set(id, g);
      }
      g.count++;
      if (r.t > g.lastT) {
        g.lastT = r.t;
        g.latest = r;
      }
      if (r.t < g.firstT) g.firstT = r.t;
      if (g.occurrences.length < 20) {
        g.occurrences.push({
          when: ago(r.t).replace(" ago", ""),
          detail: String(d.detail ?? ""),
          value: Number(d.value) || 0,
        });
      }
    }

    // Critical first, then most-recently fired.
    const list = [...groups.values()].sort((a, b) => {
      const ca = a.latest.status === "bad" ? 0 : 1;
      const cb = b.latest.status === "bad" ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return b.lastT - a.lastT;
    });

    return list.map((g) => {
      const d = this._eventData(g.latest);
      return {
        id: g.id,
        title: g.title,
        level: d.level === "critical" ? ("critical" as const) : ("warning" as const),
        status: (g.latest.status as AlertEntry["status"]) ?? "warn",
        detail: String(d.detail ?? ""),
        metric: String(d.metric ?? ""),
        value: Number(d.value) || 0,
        threshold: Number(d.threshold) || 0,
        unit: String(d.unit ?? ""),
        count: g.count,
        firstSeen: ago(g.firstT).replace(" ago", ""),
        lastSeen: ago(g.lastT).replace(" ago", ""),
        context: this._alertContext(d.context),
        occurrences: g.occurrences,
      };
    });
  }

  /** Normalise a stored alert-context blob into a typed AlertContext with safe defaults. */
  private _alertContext(raw: unknown): AlertContext {
    const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const num = (v: unknown): number => Number(v) || 0;
    return {
      errorRate: num(c.errorRate),
      rpm: num(c.rpm),
      p50: num(c.p50),
      p95: num(c.p95),
      p99: num(c.p99),
      apdex: num(c.apdex),
      pending: num(c.pending),
      rolledBack: num(c.rolledBack),
      slowRoutes: Array.isArray(c.slowRoutes) ? (c.slowRoutes as RouteStat[]).slice(0, 3) : [],
      topException: typeof c.topException === "string" ? c.topException : null,
    };
  }

  private _transactions(rows: EventRow[]): TxStats {
    const tx = rows.filter((r) => r.kind === "tx");
    const committed = tx.filter((r) => r.label === "committed").length;
    const rolledBack = tx.filter((r) => r.label === "rolledback").length;
    const durations = tx.map((r) => Number(this._eventData(r).ms) || 0).filter((m) => m > 0);
    const avgMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    return { committed, rolledBack, avgMs };
  }

  private _migrations(rows: EventRow[]): MigrationEntry[] {
    return rows
      .filter((r) => r.kind === "migration")
      .slice(0, 20)
      .map((r) => {
        const d = this._eventData(r);
        return {
          name: r.label,
          direction: String(d.direction ?? "up"),
          ms: Math.round(Number(d.ms) || 0),
          ok: r.status !== "bad",
          when: ago(r.t).replace(" ago", ""),
        };
      });
  }

  private _nplusOnes(rows: EventRow[]): NPlusOne[] {
    const groups = new Map<
      string,
      { occurrences: number; worst: number; route: string | null; last: number }
    >();
    for (const r of rows.filter((x) => x.kind === "nplus")) {
      const count = Number(this._eventData(r).count) || 0;
      const g = groups.get(r.label) ?? { occurrences: 0, worst: 0, route: r.route, last: 0 };
      g.occurrences++;
      g.worst = Math.max(g.worst, count);
      g.last = Math.max(g.last, r.t);
      if (!g.route) g.route = r.route;
      groups.set(r.label, g);
    }
    return [...groups.entries()]
      .map(([fingerprint, g]) => ({
        fingerprint,
        occurrences: g.occurrences,
        worstCount: g.worst,
        route: g.route,
        lastSeen: ago(g.last).replace(" ago", ""),
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);
  }

  private _slowJobs(rows: JobRow[]): JobEntry[] {
    return rows
      .filter((r) => r.status === "completed" || r.status === "retried" || r.status === "failed")
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10)
      .map((r) => ({
        className: r.className || "(job)",
        queue: r.queue,
        status: r.status,
        ms: r.ms,
        when: ago(r.t).replace(" ago", ""),
        error: r.error,
      }));
  }

  private _realtime(rows: EventRow[], windowMs: number): RealtimeStats {
    const ws = rows.filter((r) => r.kind === "ws");
    const actions = ws.filter((r) => r.label === "action");
    const opened = ws.filter((r) => r.label === "connect").length;
    const closed = ws.filter((r) => r.label === "disconnect").length;
    const minutes = Math.max(1, windowMs / 60000);
    const durations = actions.map((r) => Number(this._eventData(r).ms) || 0);
    const avgActionMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const n = 60;
    const series = Array.from({ length: n }, () => 0);
    const start = Date.now() - windowMs;
    for (const r of actions) {
      const idx = Math.min(
        n - 1,
        Math.max(0, Math.floor(((r.t - start) / Math.max(1, windowMs)) * n)),
      );
      series[idx] = (series[idx] ?? 0) + 1;
    }

    const byComp = new Map<string, { actions: number; total: number }>();
    for (const r of actions) {
      const d = this._eventData(r);
      const name = String(d.component ?? "?");
      const e = byComp.get(name) ?? { actions: 0, total: 0 };
      e.actions++;
      e.total += Number(d.ms) || 0;
      byComp.set(name, e);
    }
    const components = [...byComp.entries()]
      .map(([name, e]) => ({
        name,
        actions: e.actions,
        avgMs: Math.round(e.total / Math.max(1, e.actions)),
      }))
      .sort((a, b) => b.actions - a.actions)
      .slice(0, 8);

    const slowActions = actions
      .map((r) => {
        const d = this._eventData(r);
        return {
          component: String(d.component ?? "?"),
          action: String(d.action ?? "?"),
          ms: Math.round(Number(d.ms) || 0),
          when: ago(r.t).replace(" ago", ""),
        };
      })
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8);

    // Most-recent actions with their full request-scoped context (user/ip/queries/memory).
    // The table paginates this client-side, like the requests table.
    const recentActions = actions.slice(0, 50).map((r) => {
      const d = this._eventData(r);
      const queries = Array.isArray(d.queries) ? (d.queries as RequestQuery[]) : [];
      const context =
        d.context && typeof d.context === "object" && !Array.isArray(d.context)
          ? (d.context as Record<string, unknown>)
          : {};
      return {
        id: r.t,
        component: String(d.component ?? "?"),
        action: String(d.action ?? "?"),
        ms: Math.round(Number(d.ms) || 0),
        ok: d.ok !== false,
        user: typeof d.user === "string" ? d.user : null,
        ip: typeof d.ip === "string" ? d.ip : null,
        nplus: d.nplus === true,
        memKb: Math.max(0, Math.round(Number(d.memKb) || 0)),
        queries,
        context,
        when: ago(r.t).replace(" ago", ""),
      };
    });

    const mems = actions.map((r) => Number(this._eventData(r).memKb) || 0).filter((m) => m > 0);
    const avgMemKb = mems.length ? Math.round(mems.reduce((a, b) => a + b, 0) / mems.length) : 0;

    return {
      activeConnections: activeConnections(),
      actionsPerMin: Math.round((actions.length / minutes) * 10) / 10,
      avgActionMs,
      avgMemKb,
      opened,
      closed,
      series,
      components,
      slowActions,
      recentActions,
      clients: this._connectedClients(),
    };
  }

  /** Live connected Flow clients (who is online now), newest-active first. */
  private _connectedClients(): ConnectedClient[] {
    return connectedClients()
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        ip: c.ip,
        user: c.user,
        connectedFor: ago(c.connectedAt).replace(" ago", ""),
        lastActivity: c.actions > 0 ? ago(c.lastActivityAt) : "—",
        actions: c.actions,
      }));
  }

  /** Notification deliveries (one row per channel), newest first. */
  private _notifications(rows: EventRow[]): NotificationEntry[] {
    return rows
      .filter((r) => r.kind === "notification")
      .slice(0, 50)
      .map((r) => {
        const d = this._eventData(r);
        return {
          notification: r.label,
          channel: String(d.channel ?? r.route ?? "?"),
          recipient: String(d.to ?? ""),
          status: r.status === "bad" ? ("bad" as const) : ("ok" as const),
          ms: Math.round(Number(d.ms) || 0),
          when: ago(r.t).replace(" ago", ""),
        };
      });
  }

  /** Console/Artisan command runs, newest first. */
  private _commands(rows: EventRow[]): CommandEntry[] {
    return rows
      .filter((r) => r.kind === "command")
      .slice(0, 50)
      .map((r) => {
        const d = this._eventData(r);
        return {
          name: r.label,
          status: r.status === "bad" ? ("bad" as const) : ("ok" as const),
          ms: Math.round(Number(d.ms) || 0),
          code: Math.round(Number(d.code) || 0),
          when: ago(r.t).replace(" ago", ""),
        };
      });
  }

  /** Per-model created/updated/deleted counts (the models watcher). */
  private _models(rows: EventRow[]): ModelStat[] {
    const groups = new Map<string, ModelStat>();
    for (const r of rows.filter((x) => x.kind === "model")) {
      const op = String(this._eventData(r).op ?? r.route ?? "");
      const table = String(this._eventData(r).table ?? "");
      const g = groups.get(r.label) ?? {
        model: r.label,
        table,
        created: 0,
        updated: 0,
        deleted: 0,
        total: 0,
      };
      if (op === "created") g.created++;
      else if (op === "updated") g.updated++;
      else if (op === "deleted") g.deleted++;
      g.total++;
      if (!g.table && table) g.table = table;
      groups.set(r.label, g);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 20);
  }

  /** Most-recent model changes, newest first (the models-watcher timeline). */
  private _recentModels(rows: EventRow[]): ModelEvent[] {
    return rows
      .filter((r) => r.kind === "model")
      .slice(0, 30)
      .map((r) => {
        const d = this._eventData(r);
        return {
          model: r.label,
          table: String(d.table ?? ""),
          operation: String(d.op ?? r.route ?? "created") as ModelEvent["operation"],
          when: ago(r.t).replace(" ago", ""),
        };
      });
  }

  private _dbStats(rows: QueryRow[], windowMs: number): DbStat[] {
    const ms = rows.map((x) => x.ms);
    const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
    const slow = rows.filter((x) => x.ms >= this._opts.slowQueryMs).length;
    const perMin = rows.length / Math.max(1, windowMs / 60000);
    return [
      { label: "Queries / min", value: commas(perMin), sub: "reads + writes" },
      {
        label: "Avg query",
        value: `${avg.toFixed(1)}ms`,
        sub: ms.length ? `p95 ${percentile(ms, 95)}ms` : "no traffic",
      },
      {
        label: `Slow (>${this._opts.slowQueryMs}ms)`,
        value: String(slow),
        sub: "in range",
        tone: slow > 0 ? ("warn" as const) : ("ok" as const),
      },
      { label: "Connections", value: "—", sub: "pool usage" },
    ];
  }

  private _mailEntries(rows: MailRow[]): MailEntry[] {
    return rows.slice(0, 50).map((m) => ({
      id: m.t,
      subject: m.subject,
      to: m.recipient,
      mailer: m.mailer,
      status: m.status as MailEntry["status"],
      when: ago(m.t),
      ms: m.ms,
      body: m.body,
    }));
  }

  /** Fill each queue's throughput (runs/min) and trend series from recorded job runs. */
  private _enrichQueues(queues: QueueRow[], jobRows: JobRow[], windowMs: number): void {
    if (queues.length === 0) return;
    const minutes = Math.max(1, windowMs / 60000);
    const n = 24;
    const start = Date.now() - windowMs;
    const span = Math.max(1, windowMs);
    for (const q of queues) {
      const runs = jobRows.filter(
        (j) => j.queue === q.name && (j.status === "completed" || j.status === "retried"),
      );
      q.throughput = Math.round(runs.length / minutes);
      const slots = Array.from({ length: n }, () => 0);
      for (const r of runs) {
        const idx = Math.min(n - 1, Math.max(0, Math.floor(((r.t - start) / span) * n)));
        slots[idx] = (slots[idx] ?? 0) + 1;
      }
      q.series = slots;
    }
  }

  private _queueStats(queues: QueueRow[], failed: { length: number }): QueueMetric[] {
    const pending = queues.reduce((a, q) => a + q.pending, 0);
    const stats = liveQueueStats(this._app);
    const perMin = stats ? stats.processedLast5m / 5 : queues.reduce((a, q) => a + q.throughput, 0);
    return [
      { label: "Jobs / min", value: commas(perMin), sub: `across ${queues.length} queues` },
      {
        label: "Pending",
        value: commas(pending),
        sub: "waiting to run",
        tone: pending > 200 ? "warn" : "neutral",
      },
      {
        label: "Failed (24h)",
        value: String(failed.length),
        sub: "needs attention",
        tone: failed.length > 0 ? "bad" : "ok",
      },
      {
        label: "Avg wait",
        value: `${(queues.reduce((a, q) => a + q.wait, 0) / Math.max(1, queues.length)).toFixed(1)}s`,
        sub: "p95 —",
      },
    ];
  }

  private _jobTags(failed: { tags: string[] }[]): string[] {
    const tags = new Set<string>(["all"]);
    for (const j of failed) for (const t of j.tags) tags.add(t);
    return [...tags];
  }

  private _jobSeries(rows: JobRow[], windowMs: number): number[] {
    const done = rows.filter((r) => r.status === "completed" || r.status === "retried");
    const n = 60;
    const slots = Array.from({ length: n }, () => 0);
    if (done.length === 0) return slots;
    const start = Date.now() - windowMs;
    const span = Math.max(1, windowMs);
    for (const r of done) {
      const idx = Math.min(n - 1, Math.max(0, Math.floor(((r.t - start) / span) * n)));
      slots[idx] = (slots[idx] ?? 0) + 1;
    }
    return slots;
  }

  private _alerts(reqs: ReqSample[], queues: QueueRow[]): Alert[] {
    const out: Alert[] = [];
    if (reqs.length > 20) {
      const errRate = (reqs.filter((r) => r.status >= 500).length / reqs.length) * 100;
      if (errRate > 2)
        out.push({
          tone: "red",
          text: `Elevated error rate: ${errRate.toFixed(1)}% of requests are 5xx.`,
        });
    }
    const backed = queues.find((q) => q.pending > 200);
    if (backed)
      out.push({
        tone: "amber",
        text: `Queue "${backed.name}" backed up: ${backed.pending} pending, p95 wait ${backed.wait}s.`,
      });
    return out;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Bucket samples into `n` time slots; `pick` extracts the value, summed (or averaged). */
  private _bucket(
    reqs: ReqSample[],
    n: number,
    pick: (r: ReqSample) => number,
    average = false,
  ): number[] {
    if (reqs.length === 0) return Array.from({ length: n }, () => 0);
    const first = reqs.reduce((m, r) => Math.min(m, r.t), Infinity);
    const last = reqs.reduce((m, r) => Math.max(m, r.t), -Infinity);
    const span = Math.max(1, last - first);
    const sums = Array.from({ length: n }, () => 0);
    const counts = Array.from({ length: n }, () => 0);
    for (const r of reqs) {
      const idx = Math.min(n - 1, Math.floor(((r.t - first) / span) * n));
      sums[idx] = (sums[idx] ?? 0) + pick(r);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return sums.map((s, i) =>
      average ? (counts[i] ? Math.round(s / (counts[i] as number)) : 0) : s,
    );
  }

  private _synthSpans(ms: number, queries: RequestQuery[]): RequestSpan[] {
    const boot = Math.min(8, Math.round(ms * 0.05));
    const queryMs = queries.reduce((a, q) => a + q.ms, 0);
    const handler = Math.max(0, ms - boot - queryMs);
    const spans: RequestSpan[] = [{ label: "boot", kind: "boot", start: 0, dur: boot }];
    let cursor = boot;
    if (queryMs > 0) {
      spans.push({ label: "queries", kind: "query", start: cursor, dur: queryMs });
      cursor += queryMs;
    }
    spans.push({ label: "handler", kind: "controller", start: cursor, dur: handler });
    return spans;
  }

  private _rangeMs(range: MonitorRange): number {
    switch (range) {
      case "1h":
        return 60 * 60 * 1000;
      case "24h":
        return 24 * 60 * 60 * 1000;
      case "7d":
        return 7 * 24 * 60 * 60 * 1000;
      case "live":
      default:
        return 60 * 1000;
    }
  }

  private _parseQueries(json: string): RequestQuery[] {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? (v as RequestQuery[]) : [];
    } catch {
      return [];
    }
  }

  private _parseFrames(json: string): string[] {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  }

  private _stackFrames(stack?: string): string[] {
    if (!stack) return [];
    return stack
      .split("\n")
      .slice(1)
      .map((l) => l.trim().replace(/^at\s+/, ""))
      .filter(Boolean)
      .slice(0, 6);
  }
}
