# @zerotal/monitor

A production monitoring & queue dashboard for Zerotal — the "Super Panel". It
closes the _Prod monitoring dashboard_ gap in [`audit.md`](../../docs/audit.md): the
framework already collects the data (telemetry, health, queues), this package
gives it a UI.

It's a server-driven **Flow** panel: component classes render on the server,
interactions round-trip over the Flow WebSocket, no client store or API layer.
Eight tabs, faithful to `super-panel.html`:

**Overview · Requests · Exceptions · Queues · Mail · Database · Cache · System**

## Install

It's a workspace package. Add the provider after `FlowProvider`:

```ts
// bootstrap/providers.ts
import { FlowProvider } from "@zerotal/flow";
import { MonitorProvider } from "@zerotal/monitor";

export default [FlowProvider, MonitorProvider];
```

Visit `/monitor`. That's it — every panel is populated out of the box.

## Configure

```ts
// config/monitor.ts
import { MonitorConfig } from "@zerotal/monitor";

export default MonitorConfig({
  path: "/monitor",
  title: "Super Panel",
  // Gate access. Default: allowed outside production only.
  auth: (user) => user?.role === "admin",
  record: true, // install the FrameworkEvents recorder
  refreshMs: 3000, // live auto-refresh cadence
  apdexTargetMs: 100, // Apdex satisfaction threshold (T)
  slowQueryMs: 100, // "slow query" cut-off
  slowRequestMs: 1000, // "slow request" cut-off (Slow Requests widget)
  storage: "storage/monitor.sqlite", // bun:sqlite file (':memory:' for ephemeral)
  retentionDays: 7, // history kept before pruning
  retentionMode: "delete", // 'delete' or 'archive' past retention
  metrics: true, // Prometheus endpoint
  metricsPath: "/metrics",
  alerts: true, // threshold alerts (see below)
  alertThresholds: { errorRatePct: 5, p95Ms: 2000, queuePending: 500 },
});
```

## Persistence & retention

The panel persists every sample to **`bun:sqlite`**, so the **live / 1h / 24h / 7d**
ranges trace real history and **survive restarts** — not just whatever happened
since boot. Each event stream (requests, queries, exceptions, HTTP, cache, mail,
jobs) is a timestamped table; `snapshot(range)` reads the rows inside the selected
window, so every panel is range-consistent.

Data older than `retentionDays` is pruned hourly (and on boot). With
`retentionMode: 'archive'` the rows are moved to `*_archive` tables instead of being
deleted, for cold storage. The **System tab** shows live row counts and the oldest
record, plus two controls:

- **Clean up now** — prune past-retention data immediately.
- **Clear all** — wipe every recorded sample (with a confirm prompt).

Both are also available programmatically on the store: `store.prune()`,
`store.wipe()`, `store.storageInfo()`.

## How data flows

Everything is driven by core's `FrameworkEvents` bus — the same substrate the
logger and telemetry read. One subscriber (`installMonitorEventBridge`) feeds every
panel; there is **no sample data**. A quiet app shows honest zeros, never fabricated
traffic.

| Panel                                                                                                                                                                  | Event mapped                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Requests, latency p50/p95/p99, throughput, error rate, Apdex, slow routes                                                                                              | `RequestHandled` / `RequestFailed`                                                     |
| Per-request user, IP, memory; slow requests, top users, top-memory routes                                                                                              | `RequestHandled` (+ `ctx.user` / `ctx.ip()`)                                           |
| Per-request SQL queries (correlated by HttpContext) + N+1 flag                                                                                                         | `QueryExecuted` / `NPlusOneDetected`                                                   |
| Exceptions (grouped by type + route)                                                                                                                                   | `RequestFailed`                                                                        |
| Slow queries + DB stats                                                                                                                                                | `QueryExecuted`                                                                        |
| Cache hit-rate + hot keys                                                                                                                                              | `CacheQueried`                                                                         |
| Sent / queued / failed mail                                                                                                                                            | `MessageSent` / `MessageFailed`                                                        |
| Outgoing HTTP — per-host calls, p95, error rate                                                                                                                        | `OutgoingRequestCompleted`                                                             |
| Job throughput + slowest jobs                                                                                                                                          | `JobRan`                                                                               |
| **Realtime** — active WS connections, actions/min, busiest/slowest components, and per-action **user / IP / SQL queries** (Flow re-runs middleware on each round-trip) | `WebSocketConnected` / `WebSocketDisconnected` / `FlowActionHandled`                   |
| **Security** — logins, logouts, denials, tokens                                                                                                                        | `LoginSucceeded` / `LoginFailed` / `LoggedOut` / `AuthorizationDenied` / `TokenIssued` |
| **Logs** — every entry, level-filterable, request-correlated                                                                                                           | `LogManager.tap` (core logger)                                                         |
| **Database** — transactions, migrations, N+1 offenders                                                                                                                 | `TransactionCommitted` / `TransactionRolledBack` / `MigrationRan` / `NPlusOneDetected` |
| Cache evictions                                                                                                                                                        | `CacheEvicted`                                                                         |
| Scheduled-task run history + check-ins                                                                                                                                 | `TaskRan` / `TaskFailed` / `TaskSkipped` (+ `@zerotal/scheduler`)                      |
| Queues, workers, failed jobs (+ retry)                                                                                                                                 | `@zerotal/queue` (if installed)                                                        |
| Health, CPU/memory gauges, uptime, deploy SHA                                                                                                                          | `Health` + process + git/env                                                           |

For anything outside the event bus (a deploy marker, a third-party call you make
without the `Http` client), the `Monitor` facade still works and takes precedence:

```ts
import { Monitor } from "@zerotal/monitor";

Monitor.recordDeploy(gitSha);
Monitor.recordHttp({ host: "api.stripe.com", ms: 412, error: false });

// Attach metadata to the current request/action — shows on its trace:
Monitor.context({ tenant: tenant.id, plan: user.plan });
```

Every `Monitor.*` call is a no-op until the provider boots, so it's safe to call
unconditionally from anywhere.

## Prometheus

A Prometheus text-exposition endpoint is served at **`/metrics`** (on by default;
configure with `metrics` / `metricsPath`). It exports HTTP counters (cumulative
since boot), latency/Apdex/cache/queue/WS/exception gauges, system gauges, and
per-route latency — ready for Grafana and Alertmanager. Protect the path at the
network layer; it isn't behind the panel's auth so scrapers can reach it.

```
zerotal_http_requests_total 1284
zerotal_http_request_duration_ms_p95 318
zerotal_apdex 0.94
zerotal_ws_connections 12
zerotal_route_duration_ms_avg{method="GET",route="/dashboard"} 612
```

## Alerting

Threshold alerts (error-rate spike, slow p95, queue backlog, transaction
rollbacks) are evaluated every 15s, edge-triggered (each fires once when it
crosses, resets on recovery). A firing alert is logged, recorded (so it shows in
the panel), and dispatched to any handlers you register — wire those to
notifications:

```ts
import { onAlert } from "@zerotal/monitor";
import { Notification } from "@zerotal/notifications";

onAlert((alert) => Notification.route("slack", SLACK_WEBHOOK).notify(new OpsAlert(alert)));
```

Tune via config: `alerts: true`, `alertThresholds: { errorRatePct: 5, p95Ms: 2000, queuePending: 500 }`.

## Architecture

```
src/
  MonitorStore.ts        aggregation: reads windowed rows from SQLite → MonitorSnapshot
  store/                 MonitorDb (bun:sqlite persistence), percentile helpers, types
  recorder/              MonitorEventBridge — the single FrameworkEvents → store subscriber
  sources/               live adapters: queue, scheduler, health, system
  facades/Monitor.ts     app-facing record* API
  ui/
    MonitorLayout.tsx    head (fonts, Tailwind), shell
    MonitorPage.tsx      the Flow component — 8 tabs, all interactivity
    charts.tsx           sparkline / area-chart SVG helpers
    icons.ts, tones.ts   nav icons + value→colour helpers
  provider/              MonitorProvider — binds store, middleware, route
  config.ts              MonitorConfig()
```

> Tailwind is loaded from the Play CDN in `MonitorLayout` so the panel is styled
> with zero build setup — fine for an internal ops tool. Swap it for a compiled
> stylesheet in `MonitorLayout.head` for production hardening.

## Status

`maturity: experimental`. The live adapters degrade gracefully when an optional
peer (`queue`, `scheduler`, `telemetry`) isn't installed.
