import { rescueSync } from "@zerotal/core";
import type { RequestTrace } from "./RequestTrace.ts";

type Subscriber = (trace: RequestTrace | null) => void;

/** A `bun:sqlite` database, structurally — imported lazily so this module has no hard dependency. */
interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  transaction(fn: (items: RequestTrace[]) => void): (items: RequestTrace[]) => void;
  close(): void;
}

export interface TraceStoreOptions {
  /** How many traces to keep in memory and load back on open. */
  capacity?: number;
  /** SQLite file backing the history. Pass `null` to keep traces in memory only. */
  dbPath?: string | null;
  /** How long a persisted trace survives, in hours. */
  pruneHours?: number;
}

/**
 * Individual per-request SQLite writes cause event-loop stalls when hundreds of
 * deferred callbacks fire at once, so traces accumulate here and flush in one
 * transaction — 10-50x faster than N writes, and at most one stall per interval.
 */
const BATCH_MS = 500;
const MAX_PENDING = 200;

const DEFAULT_DB_PATH = ".zerotal/devtools.sqlite";

/**
 * The in-memory ring of recent request traces, optionally backed by SQLite so
 * history survives a restart.
 *
 * Nothing happens until the store is used. Opening a database — or starting a
 * prune timer — from a constructor would mean that merely *importing*
 * `@zerotal/devtools` writes a file to the working directory, in every
 * environment including production, whether or not the provider ever activates.
 * The database is therefore opened on first write or read.
 */
export class TraceStore {
  private readonly _capacity: number;
  private readonly _dbPath: string | null;
  private readonly _pruneMs: number;

  private _traces: RequestTrace[] = [];
  private _subscribers = new Set<Subscriber>();

  // Persistence state is per-instance: two stores in one process must not share
  // a handle, a prepared statement, or a pending batch.
  private _db: Db | null = null;
  private _opened = false;
  private _insert: ((items: RequestTrace[]) => void) | null = null;
  private _pending: RequestTrace[] = [];
  private _batchTimer: ReturnType<typeof setTimeout> | null = null;
  private _pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TraceStoreOptions | number = {}) {
    // A bare number is the old capacity-only form.
    const opts = typeof options === "number" ? { capacity: options } : options;
    this._capacity = opts.capacity ?? 100;
    this._dbPath =
      opts.dbPath === null ? null : (opts.dbPath ?? Bun.env["ZT_DEVTOOLS_DB"] ?? DEFAULT_DB_PATH);
    this._pruneMs =
      (opts.pruneHours ?? Number(Bun.env["ZT_DEVTOOLS_PRUNE_HOURS"] ?? 24)) * 3_600_000;
  }

  // ── Public API ────────────────────────────────────────────────────────

  push(trace: RequestTrace): void {
    this._open();
    this._traces.unshift(trace);
    if (this._traces.length > this._capacity) this._traces.length = this._capacity;
    this._schedulePersist(trace);
    for (const fn of this._subscribers) fn(trace);
  }

  all(): RequestTrace[] {
    this._open();
    return [...this._traces];
  }

  clear(): void {
    this._open();
    this._traces = [];
    this._pending.length = 0;
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    if (this._db) {
      try {
        this._db.exec("DELETE FROM zerotal_devtools_entries");
      } catch {
        /* ignore */
      }
    }
    for (const fn of this._subscribers) fn(null);
  }

  /** Subscribing does not open the database — a listener is not a read. */
  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /** Flush anything pending, stop the timers, and close the database. */
  dispose(): void {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    if (this._pending.length > 0) this._flush();
    if (this._db) {
      try {
        this._db.close();
      } catch {
        /* ignore */
      }
    }
    this._db = null;
    this._insert = null;
    this._opened = false;
    this._subscribers.clear();
  }

  /** Whether this store is persisting to SQLite. Exposed for tests and diagnostics. */
  get persisting(): boolean {
    return this._db !== null;
  }

  /**
   * How many traces this store keeps.
   *
   * Read by the SSE stream so the panel can trim its own list to the same depth.
   * The client used to cap at a hardcoded 100, so an app that configured a larger
   * capacity got the full history in the opening frame and then silently lost
   * everything past 100 as soon as the next request arrived.
   */
  get capacity(): number {
    return this._capacity;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Open the database and load history, once, on first use. */
  private _open(): void {
    if (this._opened) return;
    this._opened = true;
    if (this._dbPath === null) return;

    this._db = this._openDb(this._dbPath);
    if (!this._db) return;

    this._prune();
    this._traces = this._loadHistory();
    this._pruneTimer = setInterval(() => this._prune(), 3_600_000);
    this._pruneTimer.unref?.();
  }

  private _openDb(path: string): Db | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
      const dir = path.replace(/[\\/][^\\/]+$/, "");
      if (dir !== path) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require("node:fs") as typeof import("node:fs")).mkdirSync(dir, { recursive: true });
        } catch {
          /* ok */
        }
      }
      const db = new Database(path) as unknown as Db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS zerotal_devtools_entries (
          id         TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          payload    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rdt_created ON zerotal_devtools_entries(created_at);
      `);
      return db;
    } catch {
      // bun:sqlite unavailable, or the path is unwritable — degrade to memory only.
      return null;
    }
  }

  private _schedulePersist(trace: RequestTrace): void {
    if (!this._db) return;
    if (this._pending.length >= MAX_PENDING) this._pending.shift(); // cap memory
    this._pending.push(trace);
    if (this._batchTimer) return;
    this._batchTimer = setTimeout(() => this._flush(), BATCH_MS);
    // Never hold the process open waiting to flush.
    this._batchTimer.unref?.();
  }

  private _flush(): void {
    this._batchTimer = null;
    if (!this._db || this._pending.length === 0) return;
    const batch = this._pending.splice(0);
    try {
      if (!this._insert) {
        const stmt = this._db.prepare(
          "INSERT OR REPLACE INTO zerotal_devtools_entries (id, created_at, payload) VALUES (?,?,?)",
        );
        this._insert = this._db.transaction((items: RequestTrace[]) => {
          for (const t of items) stmt.run(t.id, t.startMs, JSON.stringify(t));
        });
      }
      this._insert(batch);
    } catch {
      // Rebuild the prepared statement on the next flush.
      this._insert = null;
    }
  }

  private _prune(): void {
    if (!this._db) return;
    try {
      this._db
        .prepare("DELETE FROM zerotal_devtools_entries WHERE created_at < ?")
        .run(Date.now() - this._pruneMs);
    } catch {
      /* ignore */
    }
  }

  private _loadHistory(): RequestTrace[] {
    const db = this._db;
    if (!db) return [];
    return rescueSync(
      () =>
        (
          db
            .prepare(
              "SELECT payload FROM zerotal_devtools_entries ORDER BY created_at DESC LIMIT ?",
            )
            .all(this._capacity) as Array<{ payload: string }>
        ).map((r) => JSON.parse(r.payload) as RequestTrace),
      [],
    );
  }
}

// ── Process-wide store ────────────────────────────────────────────────────────

let _store: TraceStore | null = null;

/**
 * The store devtools records into, created on first call.
 *
 * Lazy on purpose: the module-level `new TraceStore()` this replaced opened a
 * SQLite file and started an hourly timer at import time, so a production boot
 * that merely imported `DevtoolsProvider` created `.zerotal/devtools.sqlite` in
 * its working directory even though the provider itself is a no-op there.
 */
export function traceStore(): TraceStore {
  if (!_store) _store = new TraceStore();
  return _store;
}

/**
 * Install a pre-built store — used by {@link DevtoolsProvider} to apply the
 * app's `devtools` config, and by tests to substitute a memory-only store.
 * Disposes the store it replaces.
 *
 * @internal
 */
export function _setTraceStore(store: TraceStore | null): void {
  if (_store && _store !== store) _store.dispose();
  _store = store;
}
