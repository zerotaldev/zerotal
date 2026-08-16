/**
 * Flow → observer bridges. Flow emits its own realtime framework events
 * (`WebSocketConnected` / `WebSocketDisconnected` / `FlowActionHandled`) on the
 * core `FrameworkEvents` bus; this module forwards them to whichever observer
 * packages are installed.
 *
 * A Flow action round-trips like a request, so its monitor record carries the
 * same correlated per-request state (queries, N+1 flag, custom context) that other
 * packages buffered against the action's HttpContext — drained here through the
 * store's `collectRequestState`.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so Flow depends on none of the
 * observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { WebSocketConnected, WebSocketDisconnected, FlowActionHandled } from "./frameworkEvents.ts";

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
  collectRequestState(ctx: object): {
    queries: unknown[];
    nplus: boolean;
    context: Record<string, unknown>;
    payload: unknown;
  };
}

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  channel(descriptor: {
    id: string;
    label: string;
    badge?: string;
    title?: string;
    meta?: string[];
    warn?: string;
    order?: number;
  }): void;
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
  /**
   * Optional because it postdates the sink: a project can pin a devtools older
   * than this Flow, and an action that goes untraced is a worse panel, not a
   * crashed one.
   */
  finalise?(ctx: object, meta: { startMs: number; durationMs: number; method?: string }): void;
}

// Framework/asset noise the panel shouldn't chart as realtime traffic.
const IGNORE_PREFIXES = ["/monitor", "/metrics", "/__flow", "/__zerotal", "/__dev", "/health"];

/** Raw request path from an HttpContext (best-effort). */
function _rawPath(ctx: object): string {
  return (ctx as { url?: { pathname?: string } }).url?.pathname ?? "/";
}

/** Authenticated user identity (email → id → name), or null when unauthenticated. */
function _ctxUser(ctx: object): string | null {
  const u = (ctx as { user?: unknown }).user;
  if (u == null) return null;
  if (typeof u === "string" || typeof u === "number") return String(u);
  if (typeof u === "object") {
    const o = u as Record<string, unknown>;
    const v = o.email ?? o.id ?? o.name;
    return v != null ? String(v) : null;
  }
  return null;
}

/**
 * Resolve an observer's write surface, or `undefined` when that package is not
 * installed. The cast is confined here: each binding is declared by the package
 * that owns it, and Flow deliberately depends on none of them.
 */
function _observer<T>(app: Application, binding: string): T | undefined {
  return app.container.tryMake(binding as never) as T | undefined;
}

/**
 * Subscribe Flow's realtime events to every installed observer. Returns a disposer
 * that removes every subscription; call it from the Flow provider's `onStopping()`.
 */
export function installFlowObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const store = _observer<MonitorSink>(app, "monitor.store");
  if (store) {
    unsubs.push(
      FrameworkEvents.on(WebSocketConnected, () =>
        store.recordEvent({ kind: "ws", label: "connect", status: "info" }),
      ),
      FrameworkEvents.on(WebSocketDisconnected, () =>
        store.recordEvent({ kind: "ws", label: "disconnect", status: "info" }),
      ),
      FrameworkEvents.on(FlowActionHandled, (e) => {
        const ctx = e.ctx;
        // Skip the monitor panel's own components — its poll/refresh round-trips would
        // otherwise dominate the realtime view. Draining discards their buffered state.
        if (ctx && IGNORE_PREFIXES.some((p) => _rawPath(ctx).startsWith(p))) {
          store.collectRequestState(ctx);
          return;
        }
        // Pull the same correlated context an HTTP request gets: the user (set by
        // re-run middleware), the client IP, and the SQL queries tied to this action.
        const state = ctx
          ? store.collectRequestState(ctx)
          : { queries: [] as unknown[], nplus: false, context: {} as Record<string, unknown> };
        store.recordEvent({
          kind: "ws",
          label: "action",
          status: e.ok ? "ok" : "bad",
          route: e.component,
          data: {
            component: e.component,
            action: e.action,
            ms: Math.round(e.durationMs),
            ok: e.ok,
            user: ctx ? _ctxUser(ctx) : null,
            ip: e.ip,
            nplus: state.nplus,
            // Process heap at action completion — the same per-request memory proxy
            // HTTP requests record, captured synchronously in the emit call stack.
            memKb: Math.round(process.memoryUsage().heapUsed / 1024),
            nQueries: state.queries.length,
            queries: state.queries.slice(0, 25),
            context: state.context,
          },
        });
      }),
    );
  }

  const trace = _observer<DevtoolsSink>(app, "devtools.trace");
  if (trace) {
    trace.channel({
      id: "flow",
      label: "Flow",
      badge: "component",
      title: "action",
      meta: ["durationMs", "ip"],
      warn: "failed",
      order: 20,
    });

    unsubs.push(
      FrameworkEvents.on(FlowActionHandled, (e) => {
        // An action round-trips over the WebSocket against its own HttpContext,
        // so it buffers against that context — and then has to finalise that
        // context itself. Devtools builds traces from core's request lifecycle,
        // and a WebSocket action fires none of it, so for as long as this call
        // was missing every action buffered its evidence and dropped it: the Flow
        // tab reported "no flow activity" for apps whose every interaction is a
        // Flow action, and the queries those actions ran showed up nowhere.
        if (!e.ctx) return;
        if (IGNORE_PREFIXES.some((p) => _rawPath(e.ctx as object).startsWith(p))) return;
        trace.record(e.ctx as object, "flow", {
          component: e.component,
          action: e.action,
          durationMs: Math.round(e.durationMs),
          ip: e.ip,
          ...(e.ok ? {} : { failed: true }),
        });
        // The synthetic request behind an action is a GET of the page the action
        // ran on, so labelling it `FLOW` is what keeps it from reading as a second
        // page load in the request list.
        trace.finalise?.(e.ctx as object, {
          startMs: Date.now() - e.durationMs,
          durationMs: e.durationMs,
          method: "FLOW",
        });
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
