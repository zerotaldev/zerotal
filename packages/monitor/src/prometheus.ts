/**
 * Prometheus text-exposition exporter. Renders a {@link MonitorSnapshot} (plus
 * core `HttpMetrics`) as `text/plain; version=0.0.4` so any Prometheus scraper —
 * and the whole Grafana/Alertmanager ecosystem — can read Zerotal's metrics.
 *
 * HTTP totals are real counters (cumulative since boot, from `HttpMetrics`);
 * everything else is a gauge over the current window.
 */
import { httpMetrics } from "@zerotal/core/metrics";
import type { MonitorSnapshot } from "./store/types.ts";

function _sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function _escapeLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

export function renderPrometheus(snap: MonitorSnapshot): string {
  const m = httpMetrics();
  const out: string[] = [];
  const metric = (name: string, type: "gauge" | "counter", help: string, value: number): void => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`);
  };

  // ── HTTP ──────────────────────────────────────────────────────────────────────
  metric("zerotal_http_requests_total", "counter", "HTTP requests since boot", m.total);
  metric("zerotal_http_in_flight", "gauge", "HTTP requests currently being processed", m.inFlight);
  metric("zerotal_http_server_errors_total", "counter", "5xx responses since boot", m.serverErrors);
  metric("zerotal_http_client_errors_total", "counter", "4xx responses since boot", m.clientErrors);
  metric("zerotal_http_request_duration_ms_avg", "gauge", "Mean response time (ms)", m.avgMs);
  metric(
    "zerotal_http_request_duration_ms_p95",
    "gauge",
    "p95 response time over 5m (ms)",
    m.p95Ms,
  );
  metric("zerotal_http_requests_per_minute", "gauge", "Requests per minute over 5m", m.perMinute);
  metric("zerotal_http_success_rate", "gauge", "Success rate (%)", m.successRate);
  metric("zerotal_apdex", "gauge", "Apdex satisfaction score", snap.apdex);

  // ── Cache ─────────────────────────────────────────────────────────────────────
  metric("zerotal_cache_hit_rate", "gauge", "Cache hit rate (%)", snap.cache.hitRate);
  metric("zerotal_cache_evictions", "gauge", "Cache evictions in window", snap.cache.evictions);

  // ── Queues ────────────────────────────────────────────────────────────────────
  metric(
    "zerotal_queue_pending",
    "gauge",
    "Pending jobs across queues",
    snap.queues.reduce((a, q) => a + q.pending, 0),
  );
  metric("zerotal_queue_failed", "gauge", "Failed jobs", snap.failedJobs.length);

  // ── Database ──────────────────────────────────────────────────────────────────
  metric(
    "zerotal_db_transactions_committed",
    "gauge",
    "Committed transactions in window",
    snap.transactions.committed,
  );
  metric(
    "zerotal_db_transactions_rolledback",
    "gauge",
    "Rolled-back transactions in window",
    snap.transactions.rolledBack,
  );
  metric(
    "zerotal_db_nplus_offenders",
    "gauge",
    "Distinct N+1 offenders in window",
    snap.nplusOnes.length,
  );

  // ── Exceptions ────────────────────────────────────────────────────────────────
  metric(
    "zerotal_exceptions_total",
    "gauge",
    "Exception occurrences in window",
    snap.exceptions.reduce((a, e) => a + e.count, 0),
  );

  // ── Realtime / WebSocket ──────────────────────────────────────────────────────
  metric(
    "zerotal_ws_connections",
    "gauge",
    "Active WebSocket connections",
    snap.realtime.activeConnections,
  );
  metric(
    "zerotal_ws_actions_per_minute",
    "gauge",
    "WebSocket actions per minute",
    snap.realtime.actionsPerMin,
  );
  metric(
    "zerotal_ws_action_duration_ms_avg",
    "gauge",
    "Average WS action time (ms)",
    snap.realtime.avgActionMs,
  );

  // ── System gauges (CPU / Memory / Heap) ───────────────────────────────────────
  for (const g of snap.gauges) {
    metric(
      `zerotal_system_${_sanitize(g.label)}_percent`,
      "gauge",
      `${g.label} usage (%)`,
      g.value,
    );
  }

  // ── Per-route latency (labelled — HELP/TYPE once) ─────────────────────────────
  if (snap.slowRoutes.length) {
    out.push(
      "# HELP zerotal_route_duration_ms_avg Average response time per route (ms)",
      "# TYPE zerotal_route_duration_ms_avg gauge",
    );
    for (const r of snap.slowRoutes) {
      out.push(
        `zerotal_route_duration_ms_avg{method="${_escapeLabel(r.method)}",route="${_escapeLabel(r.path)}"} ${r.ms}`,
      );
    }
  }

  return out.join("\n") + "\n";
}
