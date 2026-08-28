/**
 * ORM → observer bridges. The ORM emits its own framework events (query, N+1,
 * transaction, migration, model-change) on the core `FrameworkEvents` bus; this
 * module forwards them to whichever observer packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so the ORM depends on none of the
 * observer packages — installing or removing an observer requires no change here.
 * When an observer is not installed its binding is absent and its wiring is skipped.
 */
import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import {
  QueryExecuted,
  NPlusOneDetected,
  ModelChanged,
  TransactionCommitted,
  TransactionRolledBack,
  MigrationRan,
} from "./events.ts";

/** The subset of the telemetry tracer this bridge calls (bound as `telemetry`). */
interface TelemetrySink {
  recordCompleted(
    name: string,
    durationMs: number,
    options?: {
      kind?: "internal" | "server" | "client" | "producer" | "consumer";
      attributes?: Record<string, string | number | boolean>;
      status?: "ok" | "error";
      errorMessage?: string;
    },
  ): unknown;
}

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordQuery(q: { sql: string; ms: number }): void;
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
  bufferQuery(ctx: object, q: { ms: number; sql: string }): void;
  markNPlus(ctx: object): void;
}

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  bufferQuery(
    ctx: object,
    q: { sql: string; bindings: unknown[]; startMs: number; durationMs: number; rowCount: number },
  ): void;
  bufferWarning(ctx: object, w: { sql: string; count: number }): void;
  channel(descriptor: {
    id: string;
    label: string;
    badge?: string;
    title?: string;
    meta?: string[];
    warn?: string;
    order?: number;
    render?: "rows" | "tree" | "table" | "kv" | "grouped";
    groupBy?: string;
    flags?: string[];
  }): void;
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/** Matched-route template (else raw path) from an HttpContext, for event routes. */
function _ctxPath(ctx: object): string {
  const c = ctx as { _routeDef?: { pattern?: string }; url?: { pathname?: string } };
  return c._routeDef?.pattern ?? c.url?.pathname ?? "/";
}

/**
 * Subscribe the ORM's events to every installed observer. Returns a disposer that
 * removes every subscription; call it from the ORM provider's `onStopping()`.
 *
 * @internal
 */
export function installOrmObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const tracer = app.container.tryMake("telemetry" as never) as TelemetrySink | undefined;
  if (tracer) {
    unsubs.push(
      FrameworkEvents.on(QueryExecuted, (e) => {
        void tracer.recordCompleted("db.query", e.durationMs, {
          kind: "client",
          attributes: { "db.statement": e.sql, "db.rows": e.rowCount },
        });
      }),
    );
  }

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      // Slow-query aggregates + the per-request query buffer, correlated by ctx.
      FrameworkEvents.on(QueryExecuted, (e) => {
        store.recordQuery({ sql: e.sql, ms: e.durationMs });
        if (e.ctx) store.bufferQuery(e.ctx, { ms: Math.round(e.durationMs), sql: e.sql });
      }),
      FrameworkEvents.on(NPlusOneDetected, (e) => {
        if (e.ctx) store.markNPlus(e.ctx);
        store.recordEvent({
          kind: "nplus",
          label: e.fingerprint.replaceAll("\x00", "?"),
          status: "warn",
          route: e.ctx ? _ctxPath(e.ctx) : null,
          data: { count: e.count },
        });
      }),
      FrameworkEvents.on(ModelChanged, (e) =>
        store.recordEvent({
          kind: "model",
          label: e.model,
          status: "info",
          route: e.operation,
          data: { table: e.table, op: e.operation },
        }),
      ),
      FrameworkEvents.on(TransactionCommitted, (e) =>
        store.recordEvent({
          kind: "tx",
          label: "committed",
          status: "ok",
          route: null,
          data: { ms: e.durationMs },
        }),
      ),
      FrameworkEvents.on(TransactionRolledBack, (e) =>
        store.recordEvent({
          kind: "tx",
          label: "rolledback",
          status: "warn",
          route: null,
          data: { ms: e.durationMs, detail: e.reason ?? "" },
        }),
      ),
      FrameworkEvents.on(MigrationRan, (e) =>
        store.recordEvent({
          kind: "migration",
          label: e.name,
          status: e.ok ? "ok" : "bad",
          route: e.direction,
          data: { direction: e.direction, ms: e.durationMs, detail: e.error ?? "" },
        }),
      ),
    );
  }

  const trace = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (trace) {
    unsubs.push(
      // Buffer each query/warning against its request context for the request trace.
      FrameworkEvents.on(QueryExecuted, (e) => {
        if (!e.ctx) return;
        trace.bufferQuery(e.ctx, {
          sql: e.sql,
          bindings: e.bindings,
          startMs: e.startMs,
          durationMs: e.durationMs,
          rowCount: e.rowCount,
        });
      }),
      FrameworkEvents.on(NPlusOneDetected, (e) => {
        if (!e.ctx) return;
        trace.bufferWarning(e.ctx, { sql: e.fingerprint.replaceAll("\x00", "?"), count: e.count });
      }),
    );

    // Two more tabs, declared as data. Both were already on the bus and neither
    // had anywhere to go: a request that wrote four rows and a request that wrote
    // none looked identical in the panel, and a transaction that rolled back
    // showed only as queries that appeared to succeed.
    //
    // Rows rather than a table for models, because the interesting thing is *how
    // many* per model, and the table view of a three-column feed is a worse
    // version of the same three columns.
    trace.channel({
      id: "models",
      label: "Models",
      badge: "operation",
      title: "model",
      meta: ["table"],
      order: 40,
      render: "grouped",
      groupBy: "model",
    });
    trace.channel({
      id: "tx",
      label: "Transactions",
      badge: "outcome",
      title: "txId",
      meta: ["durationMs", "reason"],
      warn: "rolledBack",
      order: 45,
    });

    unsubs.push(
      FrameworkEvents.on(ModelChanged, (e) => {
        // `ModelChanged` carries no context — it rides the model hooks, which run
        // wherever the write did — so the request is read from the ambient scope.
        const ctx = RequestContext.tryGet();
        if (ctx) {
          trace.record(ctx, "models", {
            model: e.model,
            table: e.table,
            operation: e.operation,
          });
        }
      }),
      FrameworkEvents.on(TransactionCommitted, (e) => {
        if (!e.ctx) return;
        trace.record(e.ctx, "tx", {
          txId: e.txId,
          outcome: "committed",
          durationMs: e.durationMs,
        });
      }),
      FrameworkEvents.on(TransactionRolledBack, (e) => {
        if (!e.ctx) return;
        trace.record(e.ctx, "tx", {
          txId: e.txId,
          outcome: "rolled back",
          durationMs: e.durationMs,
          rolledBack: true,
          ...(e.reason ? { reason: e.reason } : {}),
        });
      }),
    );
  }

  const log = app.container.tryMake("log" as never) as LogSink | undefined;
  if (log) {
    const cfg = app.container.tryMake("config");
    const slowMs = cfg?.get<number>("logging.slowQueryMs") ?? 1000;
    unsubs.push(
      FrameworkEvents.on(QueryExecuted, (e) => {
        if (e.durationMs >= slowMs) {
          log.warn("Slow query", { sql: e.sql, durationMs: e.durationMs, rowCount: e.rowCount });
        }
      }),
      FrameworkEvents.on(NPlusOneDetected, (e) =>
        log.warn("N+1 query detected", { fingerprint: e.fingerprint, count: e.count }),
      ),
      FrameworkEvents.on(TransactionRolledBack, (e) =>
        log.warn("Transaction rolled back", {
          txId: e.txId,
          durationMs: e.durationMs,
          reason: e.reason,
        }),
      ),
      FrameworkEvents.on(MigrationRan, (e) => {
        if (e.ok) {
          log.info("Migration ran", {
            name: e.name,
            direction: e.direction,
            durationMs: e.durationMs,
          });
        } else {
          log.error(
            "Migration failed",
            { name: e.name, direction: e.direction, durationMs: e.durationMs },
            new Error(e.error),
          );
        }
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
