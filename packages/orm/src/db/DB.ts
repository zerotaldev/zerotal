import type { SQLInstance } from "./sql-types.ts";
import { RequestContext, FrameworkEvents } from "@zerotal/core";
import {
  QueryExecuted,
  TransactionStarted,
  TransactionCommitted,
  TransactionRolledBack,
} from "../events.ts";
import { resolveContainerConnection } from "./resolver.ts";
import { QueryBuilder, dialectFor } from "./QueryBuilder.ts";
import { getDialect } from "./dialects/index.ts";
import { UnsupportedDialectError } from "../errors/index.ts";
import { TransactionContext } from "./TransactionContext.ts";
import { createReadWriteRouter } from "./ReadWriteRouter.ts";
import {
  preventNPlusOne as _preventNPlusOne,
  allowNPlusOne as _allowNPlusOne,
  type NPlusOneOptions,
} from "./NPlusOneDetector.ts";

// Test-override escape hatch — set by _setDbConnection() in test files.
// Production code resolves the connection from the container instead.
let _connection: SQLInstance | undefined;

/** Test helper: inject a primary connection without going through the container/provider. */
export function _setDbConnection(conn: SQLInstance | null): void {
  _connection = conn ?? undefined;
}

/**
 * Test helper: read the current injected override, or `null` when none is set.
 *
 * Distinct from {@link _getDbConnection}, which falls back to the container:
 * a helper that installs its own connection needs to restore the *override
 * slot* exactly as it found it, and cannot tell an absent override from a
 * container-resolved connection otherwise.
 */
export function _getDbConnectionOverride(): SQLInstance | null {
  return _connection ?? null;
}

/**
 * Test helper: inject a primary + replicas as a read/write router.
 * Resets to a plain primary when `replicas` is empty.
 */
export function _setReadReplicas(primary: SQLInstance, replicas: SQLInstance[]): void {
  _connection = replicas.length > 0 ? createReadWriteRouter(primary, replicas) : primary;
}

/** Resolve the active base connection.
 * Test overrides (_setDbConnection) take priority so isolated test databases
 * are not displaced by a shared Application container that may exist in the
 * same process when multiple test files run together.
 */
function _fromContainer(): SQLInstance | undefined {
  if (_connection) return _connection;
  return resolveContainerConnection();
}

/** Read the active connection (used by Schema and migration commands). */
export function _getDbConnection(): SQLInstance {
  const conn = _fromContainer();
  if (!conn)
    throw new Error("[Zerotal ORM] No database connection. Is DatabaseProvider registered?");
  return conn;
}

/** Alias used by migration command helpers. */
export function _getConnection(): SQLInstance {
  return _getDbConnection();
}

/**
 * Resolve the active connection for this call site.
 * Priority (highest first):
 *   1. TransactionContext — inside a DB.transaction() call (ALS-based)
 *   2. RequestContext._transaction — legacy request-scoped transaction
 *   3. Container 'db' singleton (production)
 *   4. _connection test override (tests without a full container)
 */
function _resolveDbConn(): SQLInstance {
  return (
    TransactionContext.getStore() ??
    (RequestContext.tryGet()?._transaction as SQLInstance | undefined) ??
    _fromContainer()!
  );
}

/**
 * Resolve the primary (writable) connection, bypassing the read/write router.
 * When no replicas are configured this is identical to `_resolveDbConn()`.
 */
function _resolvePrimaryConn(): SQLInstance {
  const conn = _resolveDbConn();
  // If conn is a ReadWriteRouter proxy, it exposes the underlying primary via __primary__
  const primary = (conn as unknown as Record<string, unknown>)["__primary__"];
  return (primary as SQLInstance | undefined) ?? conn;
}

// ── Transaction helpers ───────────────────────────────────────────────────────

let _savepointCounter = 0;

/** Run a raw, parameter-less statement on a specific connection (SAVEPOINT, etc.). */
function _runRaw(conn: SQLInstance, sql: string): Promise<unknown> {
  const arr = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  return conn(arr);
}

/** Run a parameterised statement (`?` placeholders) on a specific connection. */
function _runParams(conn: SQLInstance, sql: string, params: unknown[]): Promise<unknown> {
  const parts = sql.split("?");
  const tpl = Object.assign(parts, { raw: parts }) as unknown as TemplateStringsArray;
  return conn(tpl, ...params);
}

/** Heuristic: does this error look like a deadlock / serialization failure worth retrying? */
function _isDeadlock(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  return (
    msg.includes("deadlock") ||
    msg.includes("serialization failure") ||
    msg.includes("could not serialize") ||
    msg.includes("sqlite_busy") ||
    msg.includes("database is locked") ||
    msg.includes("40001") ||
    msg.includes("40p01")
  );
}

/** Handle returned by DB.beginTransaction() for manual commit/rollback control. */
export interface ManualTransaction {
  /** The transaction connection — use for tagged-template queries. */
  readonly sql: SQLInstance;
  /** Start a query builder bound to this transaction. */
  table(name: string): QueryBuilder;
  /** Commit and release the transaction. */
  commit(): Promise<void>;
  /** Roll back and release the transaction. */
  rollback(): Promise<void>;
}

/**
 * The `DB` facade — the entry point for database access outside the model layer.
 *
 * Bundles table queries, raw SQL, transactions, replica routing and N+1
 * detection over the connection resolved for the current call site. Connection
 * resolution is context-aware: inside a {@link DB.transaction} callback every
 * query automatically uses the transaction connection (via
 * {@link TransactionContext} AsyncLocalStorage), and when read replicas are
 * configured, reads route to a replica while writes and transactions go to the
 * primary.
 *
 * @example
 * ```ts
 * // Raw SQL (parameterised)
 * const rows = await DB.raw`SELECT * FROM users WHERE id = ${id}`;
 *
 * // Fluent query builder
 * const active = await DB.table('users').where('active', true).get();
 *
 * // Transaction — all queries inside use the tx connection automatically
 * await DB.transaction(async () => {
 *   await DB.table('accounts').where('id', 1).decrement('balance', 100);
 *   await DB.table('accounts').where('id', 2).increment('balance', 100);
 * });
 * ```
 */
export const DB = {
  /**
   * Start a chainable {@link QueryBuilder} against a table on the current
   * connection.
   * @category Tables
   */
  table(tableName: string): QueryBuilder {
    return new QueryBuilder(tableName, _resolveDbConn());
  },

  /**
   * Execute raw SQL.
   *
   * Tagged-template form (parameterized, safe):
   *   await DB.raw`SELECT * FROM users WHERE id = ${id}`
   *
   * String form (splits on `?` placeholders, same safety):
   *   await DB.raw('SELECT * FROM users WHERE id = ?', [id])
   *   await DB.raw('SELECT 1 + 1 AS n')
   * @category Queries
   */
  async raw<T = Record<string, unknown>>(
    sql: TemplateStringsArray | string,
    ...rest: unknown[]
  ): Promise<T[]> {
    const conn = _resolveDbConn();
    const startMs = Date.now();
    if (typeof sql === "string") {
      const bindings: unknown[] = Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest;
      const parts = sql.split("?");
      const tpl = Object.assign(parts, { raw: parts }) as unknown as TemplateStringsArray;
      const rows = await conn<T>(tpl, ...bindings);
      FrameworkEvents.emit(
        new QueryExecuted(
          sql,
          bindings,
          startMs,
          Date.now() - startMs,
          Array.isArray(rows) ? rows.length : 0,
          RequestContext.tryGet(),
        ),
      );
      return rows;
    }
    const rows = await conn<T>(sql, ...rest);
    const rawSql = Array.isArray((sql as TemplateStringsArray).raw)
      ? (sql as TemplateStringsArray).raw.join("?")
      : String(sql);
    FrameworkEvents.emit(
      new QueryExecuted(
        rawSql,
        rest,
        startMs,
        Date.now() - startMs,
        Array.isArray(rows) ? rows.length : 0,
        RequestContext.tryGet(),
      ),
    );
    return rows;
  },

  /**
   * Run a callback inside a database transaction.
   *
   * All BaseModel and DB queries made within the callback automatically
   * use the transaction connection via AsyncLocalStorage (TransactionContext).
   * Works in any environment — request handlers, console commands, seeders.
   *
   * Bun auto-commits on resolve and auto-rolls-back on throw.
   * NEVER call tx.commit() or tx.rollback() manually.
   *
   * Nested calls use a `SAVEPOINT` so an inner rollback does not abort the outer
   * transaction. Pass `attempts > 1` to automatically retry on deadlock /
   * serialization failures.
   *
   * @param callback - Work to run inside the transaction.
   * @param attempts - Max attempts on deadlock-like errors (default 1 = no retry).
   * @category Transactions
   */
  async transaction<T>(callback: (tx?: SQLInstance) => Promise<T>, attempts = 1): Promise<T> {
    const existingTx = TransactionContext.getStore();
    if (existingTx) {
      // Nested transaction → use a SAVEPOINT so an inner rollback does not abort
      // the entire outer transaction (true nested-transaction semantics).
      const name = `zerotal_sp_${++_savepointCounter}`;
      await _runRaw(existingTx, `SAVEPOINT ${name}`);
      try {
        const result = await TransactionContext.run(existingTx, () => callback(existingTx));
        await _runRaw(existingTx, `RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (err) {
        await _runRaw(existingTx, `ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
      }
    }

    const ctx = RequestContext.tryGet();
    const maxAttempts = Math.max(1, attempts);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const txId = crypto.randomUUID();
      const start = performance.now();
      FrameworkEvents.emit(new TransactionStarted(txId, ctx));
      try {
        const result = await _fromContainer()!.begin(async (tx: SQLInstance) => {
          // TransactionContext (ALS) is the authoritative propagation mechanism. ctx._transaction
          // is maintained only for legacy callers that read it directly; save and restore the
          // previous value rather than blanking it, so a nested or concurrent transaction
          // finishing does not clear an outer one's entry.
          const previousTx = ctx?._transaction;
          if (ctx) ctx._transaction = tx;
          try {
            return await TransactionContext.run(tx, () => callback(tx));
          } finally {
            if (ctx) ctx._transaction = previousTx;
          }
        });
        FrameworkEvents.emit(
          new TransactionCommitted(txId, Math.round(performance.now() - start), ctx),
        );
        return result;
      } catch (err) {
        lastErr = err;
        const reason = (err as { message?: string })?.message;
        FrameworkEvents.emit(
          new TransactionRolledBack(txId, Math.round(performance.now() - start), reason, ctx),
        );
        if (attempt < maxAttempts && _isDeadlock(err)) continue;
        throw err;
      }
    }
    throw lastErr;
  },

  /**
   * Begin a transaction with **manual** commit/rollback control. Run queries via
   * the returned handle (`handle.sql` or `handle.table()`), then call
   * `handle.commit()` or `handle.rollback()`.
   *
   * Prefer `DB.transaction(cb)` for automatic commit/rollback — this is for the
   * rarer cases where the transaction boundary cannot be expressed as a callback.
   *
   * @example
   * const t = await DB.beginTransaction();
   * try {
   *   await t.table('accounts').where('id', 1).decrement('balance', 100);
   *   await t.commit();
   * } catch (e) { await t.rollback(); throw e; }
   * @category Transactions
   */
  async beginTransaction(): Promise<ManualTransaction> {
    const conn = _fromContainer()!;
    const ROLLBACK = Symbol("zerotal.rollback");
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    let markReady!: () => void;
    const ready = new Promise<void>((r) => {
      markReady = r;
    });
    let txConn!: SQLInstance;
    let outcome: "commit" | "rollback" = "commit";

    // Hold the transaction open inside Bun's begin() callback until commit/rollback
    // resolves the gate. Throwing the ROLLBACK sentinel triggers Bun's auto-rollback.
    const done = conn
      .begin(async (tx: SQLInstance) => {
        txConn = tx;
        markReady();
        await gate;
        if (outcome === "rollback") throw ROLLBACK;
      })
      .then(
        () => undefined,
        (e: unknown) => {
          if (e !== ROLLBACK) throw e;
        },
      );

    await ready;

    const txId = crypto.randomUUID();
    const start = performance.now();
    const ctx = RequestContext.tryGet();
    FrameworkEvents.emit(new TransactionStarted(txId, ctx));

    let settled = false;
    const finish = async (mode: "commit" | "rollback"): Promise<void> => {
      if (settled) return;
      settled = true;
      outcome = mode;
      releaseGate();
      try {
        await done;
      } catch (err) {
        FrameworkEvents.emit(
          new TransactionRolledBack(
            txId,
            Math.round(performance.now() - start),
            (err as { message?: string })?.message,
            ctx,
          ),
        );
        throw err;
      }
      if (mode === "commit") {
        FrameworkEvents.emit(
          new TransactionCommitted(txId, Math.round(performance.now() - start), ctx),
        );
      } else {
        FrameworkEvents.emit(
          new TransactionRolledBack(txId, Math.round(performance.now() - start), undefined, ctx),
        );
      }
    };

    return {
      sql: txConn,
      table: (name: string) => new QueryBuilder(name, txConn),
      commit: () => finish("commit"),
      rollback: () => finish("rollback"),
    };
  },

  /**
   * Return a query builder scoped to the **primary** connection, bypassing
   * the replica pool entirely.
   *
   * Use this for **read-your-writes** scenarios — when you need to query data
   * immediately after a mutation and cannot wait for replication lag.
   *
   * @example
   * await DB.table('orders').insert({ total: 99 });
   *
   * // Read the just-inserted row from primary, not a potentially-lagging replica:
   * const order = await DB.onPrimary().table('orders').where('id', id).first();
   * @category Connections
   */
  onPrimary(): { table(name: string): QueryBuilder } {
    const conn = _resolvePrimaryConn();
    return {
      table: (name: string) => new QueryBuilder(name, conn),
    };
  },

  /**
   * Return the active transaction connection (from the ALS transaction context
   * or the legacy request-scoped transaction), or `undefined` when none is open.
   * @category Transactions
   */
  currentTx(): unknown | undefined {
    return (
      TransactionContext.getStore() ??
      (RequestContext.tryGet()?._transaction as SQLInstance | undefined)
    );
  },

  /**
   * Acquire a database advisory lock for the duration of a callback.
   * The lock is released automatically when the callback resolves or rejects.
   *
   * Dialect-aware: `pg_advisory_lock()` on PostgreSQL, `GET_LOCK()` on MySQL.
   * Throws `UnsupportedDialectError` (E_UNSUPPORTED_DIALECT) on SQLite, which
   * has no advisory-lock primitive.
   *
   * @param key      Integer lock key (application-defined).
   * @param callback Work to perform while the lock is held.
   * @throws {UnsupportedDialectError} On SQLite (no advisory-lock primitive).
   * @category Connections
   */
  async advisoryLock<T>(key: number, callback: () => Promise<T>): Promise<T> {
    const conn = _resolveDbConn();
    const dialect = getDialect(dialectFor(conn));
    if (!dialect.supportsAdvisoryLocks) {
      throw new UnsupportedDialectError("DB.advisoryLock()", dialect.name);
    }
    const lock = dialect.advisoryLockSql(key)!;
    const unlock = dialect.advisoryUnlockSql(key)!;
    await _runParams(conn, lock.sql, lock.params);
    try {
      return await callback();
    } finally {
      await _runParams(conn, unlock.sql, unlock.params);
    }
  },

  /**
   * Configure N+1 query detection.
   *
   * Detection is automatically active in `local` and `development` environments
   * (warn mode, threshold 5). Call this to change the threshold, switch to
   * 'throw' mode, or enable detection in other environments.
   *
   * @example
   * // bootstrap/app.ts
   * DB.preventNPlusOne({ threshold: 3, mode: 'throw' });
   * @category Queries
   */
  preventNPlusOne(options?: NPlusOneOptions): void {
    _preventNPlusOne(options);
  },

  /**
   * Suppress N+1 warnings for queries containing `pattern` as a substring.
   *
   * @param pattern  A table name or any substring of the SQL shape.
   * @param options  `{ once: true }` suppresses only for the current request.
   *
   * @example
   * DB.allowNPlusOne('activity_logs');              // all requests
   * DB.allowNPlusOne('taggings', { once: true });   // this request only
   * @category Queries
   */
  allowNPlusOne(pattern: string, options?: { once?: boolean }): void {
    _allowNPlusOne(pattern, options, RequestContext.tryGet());
  },
};
