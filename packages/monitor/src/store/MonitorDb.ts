/**
 * SQLite persistence for the monitoring panel (`bun:sqlite`).
 *
 * Every recorded event is appended with a millisecond timestamp, so the panel
 * can trace history across the live / 1h / 24h / 7d ranges **and survive
 * restarts** — not just show whatever happened since boot. A retention policy
 * prunes (or archives) rows older than the configured window, and the store can
 * be wiped on demand from the panel.
 *
 * Use `:memory:` for tests; a file path for real persistence.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

export type RetentionMode = "delete" | "archive";

export interface RequestRow {
  t: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  nplus: number;
  queries: string; // JSON-encoded RequestQuery[]
  user: string | null; // authenticated user id/email, or null when unauthenticated
  ip: string | null; // client IP
  mem: number; // process heap (KB) at request completion — a per-request proxy
  context: string; // JSON metadata from Monitor.context()
  payload?: string | null; // JSON RequestPayload (headers+bodies), when capture is on
  error?: string | null; // exception message when the request failed
}
export interface QueryRow {
  t: number;
  sql: string;
  ms: number;
  location: string;
}
export interface ExceptionRow {
  t: number;
  type: string;
  message: string;
  location: string;
  frames: string; // JSON-encoded string[]
  user: string | null; // authenticated user who hit it, or null
}
export interface HttpRow {
  t: number;
  host: string;
  ms: number;
  error: number;
}
export interface CacheRow {
  t: number;
  hit: number;
  key: string;
}
export interface MailRow {
  t: number;
  subject: string;
  recipient: string;
  mailer: string;
  status: string;
  ms: number;
  body: string;
}
export interface DeployRow {
  t: number;
  sha: string;
}
export interface JobRow {
  t: number;
  status: string;
  className: string;
  queue: string;
  ms: number;
  error: string | null;
}

/** Generic framework-event row — powers the security, transactions, migrations,
 *  N+1, cache-eviction, scheduler, and realtime/WS feeds from one table. */
export interface EventRow {
  t: number;
  kind: string; // "auth" | "tx" | "migration" | "nplus" | "cache_evict" | "task" | "ws"
  label: string; // human label, e.g. "login.failed", "rollback", route/component name
  status: string; // "ok" | "warn" | "bad" | "info"
  route: string | null; // associated route/component, when known
  data: string; // JSON detail
}

/** Row counts + oldest sample, for the System tab's storage panel. */
export interface StorageInfo {
  requests: number;
  queries: number;
  exceptions: number;
  httpCalls: number;
  cacheEvents: number;
  mail: number;
  jobs: number;
  deploys: number;
  archived: number;
  oldestMs: number | null;
}

// Column definitions per table (`t` first; archive mirrors share the schema).
const SCHEMA: Record<string, string> = {
  mon_requests:
    "t INTEGER NOT NULL, method TEXT, path TEXT, status INTEGER, ms INTEGER, nplus INTEGER, queries TEXT, user TEXT, ip TEXT, mem INTEGER, context TEXT, payload TEXT, error TEXT",
  mon_queries: "t INTEGER NOT NULL, sql TEXT, ms INTEGER, location TEXT",
  mon_exceptions:
    "t INTEGER NOT NULL, type TEXT, message TEXT, location TEXT, frames TEXT, user TEXT",
  mon_http: "t INTEGER NOT NULL, host TEXT, ms INTEGER, error INTEGER",
  mon_cache: "t INTEGER NOT NULL, hit INTEGER, key TEXT",
  mon_mail:
    "t INTEGER NOT NULL, subject TEXT, recipient TEXT, mailer TEXT, status TEXT, ms INTEGER, body TEXT",
  mon_deploys: "t INTEGER NOT NULL, sha TEXT",
  mon_jobs: "t INTEGER NOT NULL, status TEXT, className TEXT, queue TEXT, ms INTEGER, error TEXT",
  mon_events: "t INTEGER NOT NULL, kind TEXT, label TEXT, status TEXT, route TEXT, data TEXT",
};

// Prepared insert per table (column order matches the value arrays pushed by record*).
const INSERTS: Record<string, string> = {
  mon_requests:
    "INSERT INTO mon_requests (t,method,path,status,ms,nplus,queries,user,ip,mem,context,payload,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  mon_queries: "INSERT INTO mon_queries (t,sql,ms,location) VALUES (?,?,?,?)",
  mon_exceptions:
    "INSERT INTO mon_exceptions (t,type,message,location,frames,user) VALUES (?,?,?,?,?,?)",
  mon_http: "INSERT INTO mon_http (t,host,ms,error) VALUES (?,?,?,?)",
  mon_cache: "INSERT INTO mon_cache (t,hit,key) VALUES (?,?,?)",
  mon_mail:
    "INSERT INTO mon_mail (t,subject,recipient,mailer,status,ms,body) VALUES (?,?,?,?,?,?,?)",
  mon_deploys: "INSERT INTO mon_deploys (t,sha) VALUES (?,?)",
  mon_jobs: "INSERT INTO mon_jobs (t,status,className,queue,ms,error) VALUES (?,?,?,?,?,?)",
  mon_events: "INSERT INTO mon_events (t,kind,label,status,route,data) VALUES (?,?,?,?,?,?)",
};

/** Flush the write buffer at least this often, and whenever it reaches the size cap. */
const FLUSH_MS = 1000;
const FLUSH_AT = 2000;

export class MonitorDb {
  private readonly _db: Database;
  // Write buffer: record* enqueues here (an array push, no I/O) and a timer flushes
  // batched inserts off the request hot path. Keyed by table → rows of value arrays.
  private readonly _pending = new Map<string, unknown[][]>();
  private _pendingCount = 0;
  private readonly _flushTimer: ReturnType<typeof setInterval>;

  constructor(path = ":memory:") {
    if (path !== ":memory:") {
      const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      if (slash > 0) {
        try {
          mkdirSync(path.slice(0, slash), { recursive: true });
        } catch {
          /* directory may already exist */
        }
      }
    }
    this._db = new Database(path, { create: true });
    this._db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this._migrate();
    this._flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    (this._flushTimer as { unref?: () => void }).unref?.();
  }

  /** Buffer one row for `table` (an array push). Flushes early if the buffer is full. */
  private _enqueue(table: string, values: unknown[]): void {
    let rows = this._pending.get(table);
    if (!rows) {
      rows = [];
      this._pending.set(table, rows);
    }
    rows.push(values);
    if (++this._pendingCount >= FLUSH_AT) this.flush();
  }

  /** Persist all buffered rows in one transaction. Called by the timer, before reads, on dispose. */
  flush(): void {
    if (this._pendingCount === 0) return;
    try {
      this._db.transaction(() => {
        for (const [table, rows] of this._pending) {
          if (rows.length === 0) continue;
          const stmt = this._db.query(INSERTS[table]!);
          for (const vals of rows) stmt.run(...(vals as never[]));
        }
      })();
    } catch {
      /* recording must never break the app; drop the batch rather than throw */
    }
    this._pending.clear();
    this._pendingCount = 0;
  }

  private _migrate(): void {
    for (const [name, cols] of Object.entries(SCHEMA)) {
      this._db.exec(
        `CREATE TABLE IF NOT EXISTS ${name} (${cols});` +
          `CREATE INDEX IF NOT EXISTS idx_${name}_t ON ${name}(t);` +
          `CREATE TABLE IF NOT EXISTS ${name}_archive (${cols});`,
      );
    }
    // Columns added after the initial release — applied idempotently so an older
    // on-disk database upgrades in place rather than erroring on the new SELECTs.
    for (const t of ["mon_requests", "mon_requests_archive"]) {
      this._addColumn(t, "user", "TEXT");
      this._addColumn(t, "ip", "TEXT");
      this._addColumn(t, "mem", "INTEGER");
      this._addColumn(t, "context", "TEXT");
    }
    for (const t of ["mon_jobs", "mon_jobs_archive"]) {
      this._addColumn(t, "className", "TEXT");
      this._addColumn(t, "queue", "TEXT");
      this._addColumn(t, "ms", "INTEGER");
      this._addColumn(t, "error", "TEXT");
    }
    for (const t of ["mon_exceptions", "mon_exceptions_archive"]) {
      this._addColumn(t, "user", "TEXT");
    }
    for (const t of ["mon_requests", "mon_requests_archive"]) {
      this._addColumn(t, "payload", "TEXT");
      this._addColumn(t, "error", "TEXT");
    }
    // Composite index for the per-route drill-in (method+path filtered over a window).
    // The per-table idx_*_t already covers the plain time-range scans every feed uses.
    this._db.exec(
      "CREATE INDEX IF NOT EXISTS idx_mon_requests_route ON mon_requests(method, path, t)",
    );
  }

  private _addColumn(table: string, col: string, type: string): void {
    try {
      this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* column already exists */
    }
  }

  // ── Inserts ──────────────────────────────────────────────────────────────────

  recordRequest(r: RequestRow): void {
    this._enqueue("mon_requests", [
      r.t,
      r.method,
      r.path,
      r.status,
      r.ms,
      r.nplus,
      r.queries,
      r.user,
      r.ip,
      r.mem,
      r.context,
      r.payload ?? null,
      r.error ?? null,
    ]);
  }
  recordQuery(r: QueryRow): void {
    this._enqueue("mon_queries", [r.t, r.sql, r.ms, r.location]);
  }
  recordException(r: ExceptionRow): void {
    this._enqueue("mon_exceptions", [r.t, r.type, r.message, r.location, r.frames, r.user]);
  }
  recordHttp(r: HttpRow): void {
    this._enqueue("mon_http", [r.t, r.host, r.ms, r.error]);
  }
  recordCache(r: CacheRow): void {
    this._enqueue("mon_cache", [r.t, r.hit, r.key]);
  }
  recordMail(r: MailRow): void {
    this._enqueue("mon_mail", [r.t, r.subject, r.recipient, r.mailer, r.status, r.ms, r.body]);
  }
  recordDeploy(r: DeployRow): void {
    this._enqueue("mon_deploys", [r.t, r.sha]);
  }
  recordJob(r: JobRow): void {
    this._enqueue("mon_jobs", [r.t, r.status, r.className, r.queue, r.ms, r.error]);
  }
  recordEvent(r: EventRow): void {
    this._enqueue("mon_events", [r.t, r.kind, r.label, r.status, r.route, r.data]);
  }

  // ── Windowed reads (t >= cutoff) ─────────────────────────────────────────────

  requestsWithin(cutoff: number): RequestRow[] {
    return this._db
      .query(
        "SELECT t,method,path,status,ms,nplus,queries,user,ip,mem,context,payload,error FROM mon_requests WHERE t >= ? ORDER BY t ASC",
      )
      .all(cutoff) as RequestRow[];
  }
  requestsBetween(from: number, to: number): RequestRow[] {
    return this._db
      .query(
        "SELECT t,method,path,status,ms,nplus,queries,user,ip,mem,context FROM mon_requests WHERE t >= ? AND t < ?",
      )
      .all(from, to) as RequestRow[];
  }
  /** All requests to one method+path within the window (per-route drill-in). */
  requestsForRouteWithin(method: string, path: string, cutoff: number): RequestRow[] {
    return this._db
      .query(
        "SELECT t,method,path,status,ms,nplus,queries,user,ip,mem,context,payload,error FROM mon_requests WHERE t >= ? AND method = ? AND path = ? ORDER BY t ASC",
      )
      .all(cutoff, method, path) as RequestRow[];
  }
  queriesWithin(cutoff: number): QueryRow[] {
    return this._db
      .query("SELECT t,sql,ms,location FROM mon_queries WHERE t >= ?")
      .all(cutoff) as QueryRow[];
  }
  exceptionsWithin(cutoff: number): ExceptionRow[] {
    return this._db
      .query(
        "SELECT t,type,message,location,frames,user FROM mon_exceptions WHERE t >= ? ORDER BY t ASC",
      )
      .all(cutoff) as ExceptionRow[];
  }
  httpWithin(cutoff: number): HttpRow[] {
    return this._db
      .query("SELECT t,host,ms,error FROM mon_http WHERE t >= ?")
      .all(cutoff) as HttpRow[];
  }
  cacheWithin(cutoff: number): CacheRow[] {
    return this._db.query("SELECT t,hit,key FROM mon_cache WHERE t >= ?").all(cutoff) as CacheRow[];
  }
  mailWithin(cutoff: number): MailRow[] {
    return this._db
      .query(
        "SELECT t,subject,recipient,mailer,status,ms,body FROM mon_mail WHERE t >= ? ORDER BY t DESC LIMIT 100",
      )
      .all(cutoff) as MailRow[];
  }
  jobsWithin(cutoff: number): JobRow[] {
    return this._db
      .query("SELECT t,status,className,queue,ms,error FROM mon_jobs WHERE t >= ?")
      .all(cutoff) as JobRow[];
  }
  eventsWithin(cutoff: number): EventRow[] {
    return this._db
      .query("SELECT t,kind,label,status,route,data FROM mon_events WHERE t >= ? ORDER BY t DESC")
      .all(cutoff) as EventRow[];
  }
  deploysWithin(cutoff: number): DeployRow[] {
    return this._db
      .query("SELECT t,sha FROM mon_deploys WHERE t >= ? ORDER BY t DESC LIMIT 8")
      .all(cutoff) as DeployRow[];
  }

  // ── Retention ────────────────────────────────────────────────────────────────

  /** Remove (or archive then remove) every row older than `cutoff`. Returns rows removed. */
  prune(cutoff: number, mode: RetentionMode): number {
    this.flush(); // persist buffered rows so they aren't lost/miscounted
    let removed = 0;
    const tx = this._db.transaction(() => {
      for (const name of Object.keys(SCHEMA)) {
        if (mode === "archive") {
          this._db
            .query(`INSERT INTO ${name}_archive SELECT * FROM ${name} WHERE t < ?`)
            .run(cutoff);
        }
        const res = this._db.query(`DELETE FROM ${name} WHERE t < ?`).run(cutoff);
        removed += Number(res.changes);
      }
    });
    tx();
    return removed;
  }

  /** Delete all recorded data (optionally including the archive). Returns rows removed. */
  wipe(includeArchive = false): number {
    this._pending.clear(); // discard buffered rows — we're deleting everything anyway
    this._pendingCount = 0;
    let removed = 0;
    const tx = this._db.transaction(() => {
      for (const name of Object.keys(SCHEMA)) {
        removed += Number(this._db.query(`DELETE FROM ${name}`).run().changes);
        if (includeArchive) this._db.query(`DELETE FROM ${name}_archive`).run();
      }
    });
    tx();
    return removed;
  }

  /** Row counts + oldest sample, for the storage panel. */
  info(): StorageInfo {
    this.flush(); // counts should include just-recorded rows
    const count = (t: string): number =>
      Number((this._db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
    const oldest = (
      this._db.query("SELECT MIN(t) AS m FROM mon_requests").get() as { m: number | null }
    ).m;
    let archived = 0;
    for (const name of Object.keys(SCHEMA)) archived += count(`${name}_archive`);
    return {
      requests: count("mon_requests"),
      queries: count("mon_queries"),
      exceptions: count("mon_exceptions"),
      httpCalls: count("mon_http"),
      cacheEvents: count("mon_cache"),
      mail: count("mon_mail"),
      jobs: count("mon_jobs"),
      deploys: count("mon_deploys"),
      archived,
      oldestMs: oldest ?? null,
    };
  }

  dispose(): void {
    clearInterval(this._flushTimer);
    this.flush();
    this._db.close();
  }
}
