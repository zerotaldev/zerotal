/**
 * The monitor's core-signal bridge: subscribes to the framework's request
 * lifecycle (`RequestHandled` / `RequestFailed`), outgoing HTTP calls, and console
 * commands, and records each request together with the query / N+1 / custom-context
 * / payload that feature packages buffered against it while it was in flight (see
 * recorder/ctxBuffers.ts).
 *
 * Feature packages contribute their own events (DB, cache, mail, jobs, auth,
 * realtime) through their own monitor bridge, which resolves the {@link MonitorStore}
 * from the container. The monitor therefore imports none of them, and adding a
 * feature package requires no change here.
 */
import { FrameworkEvents } from "@zerotal/core";
import type {
  RequestHandled,
  RequestFailed,
  OutgoingRequestCompleted,
  CommandRan,
} from "@zerotal/core";
import type { MonitorStore } from "../MonitorStore.ts";
import { markRecorded } from "./ctxBuffers.ts";

// Framework/asset noise the panel shouldn't chart as application traffic.
const IGNORE_PREFIXES = [
  "/monitor",
  "/metrics",
  "/__flow",
  "/__zerotal",
  "/__dev",
  "/health",
  "/favicon",
  "/assets",
  "/build",
];

interface HttpCtxShape {
  url?: { pathname?: string };
  request?: { method?: string };
  response?: { status?: number };
  _routeDef?: { pattern?: string };
  user?: unknown;
  ip?: () => string | null;
}

/** Method, matched-route template, raw path, and status from an HttpContext. */
function _ctxInfo(raw: object): { method: string; path: string; rawPath: string; status: number } {
  const c = raw as HttpCtxShape;
  const rawPath = c.url?.pathname ?? "/";
  return {
    method: (c.request?.method ?? "GET").toUpperCase(),
    path: c._routeDef?.pattern ?? rawPath, // prefer /posts/:id over /posts/42
    rawPath,
    status: c.response?.status ?? 0,
  };
}

/** Authenticated user identity (email → id → name), or null when unauthenticated. */
function _ctxUser(raw: object): string | null {
  const u = (raw as HttpCtxShape).user;
  if (u == null) return null;
  if (typeof u === "string" || typeof u === "number") return String(u);
  if (typeof u === "object") {
    const o = u as Record<string, unknown>;
    const v = o.email ?? o.id ?? o.name;
    return v != null ? String(v) : null;
  }
  return null;
}

/** Client IP from the HttpContext (best-effort — null when unavailable). */
function _ctxIp(raw: object): string | null {
  try {
    return (raw as HttpCtxShape).ip?.() ?? null;
  } catch {
    return null;
  }
}

/** Recover a "XxxError" class name from a framework error message, else "Error". */
function _errorType(message: string): string {
  const match = /^([A-Za-z]*Error)\b/.exec(message);
  return match?.[1] ?? "Error";
}

export function installMonitorEventBridge(store: MonitorStore): () => void {
  /** Finalise one request: drain its buffered correlation state, record it once. */
  const recordRequest = (
    ctx: object,
    statusOverride: number,
    durationMs: number,
    error: string | null = null,
  ): void => {
    if (!markRecorded(ctx)) return; // success + failure can both fire; record once

    const info = _ctxInfo(ctx);
    // Drain buffers even for ignored paths so they don't leak into a later request
    // that reuses the context object.
    const { queries, nplus, context, payload } = store.collectRequestState(ctx);
    if (IGNORE_PREFIXES.some((p) => info.rawPath.startsWith(p))) return;

    store.recordRequest({
      method: info.method,
      path: info.path,
      status: statusOverride || info.status,
      ms: durationMs,
      queries,
      nplus,
      user: _ctxUser(ctx),
      ip: _ctxIp(ctx),
      // Process heap at completion — a per-request memory proxy (the runtime shares
      // one heap, so this is indicative, not isolated like PHP-FPM peak memory).
      memKb: Math.round(process.memoryUsage().heapUsed / 1024),
      context,
      payload,
      error,
    });
  };

  const unsubs: Array<() => void> = [
    // ── Requests — full per-request trace ──────────────────────────────────────
    FrameworkEvents.on<RequestHandled>("RequestHandled", (e) =>
      recordRequest(e.ctx, 0, e.durationMs),
    ),
    FrameworkEvents.on<RequestFailed>("RequestFailed", (e) => {
      store.recordException(
        { type: _errorType(e.error), message: e.error },
        _ctxInfo(e.ctx).path,
        _ctxUser(e.ctx),
      );
      recordRequest(e.ctx, e.status, e.durationMs, e.error);
    }),

    // ── Outgoing HTTP — per-host calls, p95, error rate ────────────────────────
    FrameworkEvents.on<OutgoingRequestCompleted>("OutgoingRequestCompleted", (e) => {
      store.recordHttp({ host: e.host, ms: e.durationMs, error: !e.ok });
    }),

    // ── Console / Artisan command runs ─────────────────────────────────────────
    FrameworkEvents.on<CommandRan>("CommandRan", (e) =>
      store.recordEvent({
        kind: "command",
        label: e.name,
        status: e.ok ? "ok" : "bad",
        route: null,
        data: {
          ms: Math.round(e.durationMs),
          code: e.exitCode,
          detail: e.error ?? `exit ${e.exitCode}`,
        },
      }),
    ),
  ];

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
