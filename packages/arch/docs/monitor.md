---
title: Monitor
description: The Super Panel — a self-hosted, real-data monitoring dashboard for requests, queries, jobs, cache, realtime, and more, built on the same event bus the logger reads.
---

# Monitor

`@zerotal/monitor` is the **Super Panel**: a production monitoring dashboard that ships with your app. It rolls request-level debugging and live application metrics into one — a server-driven Flow page that reads from the framework's `FrameworkEvents` bus, persists every sample to its own SQLite file, and renders fourteen tabs of live, range-aware data. There is no sample data and no separate agent to run: a quiet app shows honest zeros, a busy one shows exactly what happened.

The panel observes HTTP requests, SQL queries (with N+1 detection), exceptions, the cache, queues and jobs, outgoing HTTP, mail, notifications, console commands, model changes, scheduled tasks, security events, application logs, and Flow WebSocket activity — and it raises threshold alerts on top of all of it.

## Getting Started

It is a workspace package. Add the provider after `FlowProvider` in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { FlowProvider } from "@zerotal/flow";
import { MonitorProvider } from "@zerotal/monitor";

export default [FlowProvider, MonitorProvider];
```

Visit `/monitor`. Every tab populates from real activity as soon as your app handles traffic — nothing else to wire up.

## What each tab shows

The sidebar groups the tabs into **Monitoring**, **Jobs & Mail**, and **Infrastructure**. If you are not sure where to look, this is the map.

**Overview** is the at-a-glance health screen, ordered from "right now" to
"what's slow". It reads top to bottom in four bands:

- **Live pulse** — the truly real-time gauges: HTTP requests currently being
  processed (in-flight concurrency), open WebSocket connections, requests per
  second, and the current error rate. Each carries a status dot that pulses while
  there is activity.
- **Performance and health** — a compact latency profile (p50/p95/p99), the Apdex
  and cache-hit scores, and the busiest WebSocket components.
- **Throughput** — one chart overlaying HTTP requests and WebSocket actions on a
  single timeline, so you can correlate a spike across both.
- **System bottlenecks** — the slowest routes, top exceptions, and slow outgoing
  HTTP side by side, for a single horizontal scan.

Start at the pulse, then scan down to whatever looks wrong.

**Requests** is the request explorer. Every request is a row: method, route,
status, the authenticated user, IP, query count, peak memory, and duration.

Click a row to expand its full trace — a span waterfall, the exact SQL that ran
(correlated to that request), and its log lines. A failed request shows its
exception message inline, so the trace explains why it failed. With
`capturePayloads` on, the trace also carries the request and response headers and
bodies, with sensitive headers and keys redacted.

Three widgets sit alongside: Slow requests, Application usage (busiest users),
and Top memory (heaviest routes). Search by path or method, filter by status
class, and page through ten at a time.

Clicking a route name — here or in the Overview's slow-routes list — opens a
**per-route drill-in**: that one route's latency percentiles, throughput, error
rate, status breakdown, and its recent and slowest requests. The drill-in is
shareable, because its URL carries the route — a refresh or a link reopens it.

**Realtime** is the same idea for Flow WebSocket actions. Flow re-runs your
middleware on every round-trip, so each action carries the same rich context a
request does: user, IP, the SQL it ran, and per-action memory.

The tab shows live connection counts, actions per minute, a **Connected clients**
list (who is online right now, not just how many), the busiest components, the
slowest actions, and a searchable, paginated action log with expandable traces.

The monitor excludes its own polling from this view, so you see your app rather
than the panel watching itself.

**Exceptions** groups failures by type and location, with a sparkline, 24h/7d/30d counts, the affected-user count, and an expandable stack trace.

**Alerts** is the history of threshold alerts that have fired. They are grouped
by kind, so a flapping metric collapses into one card with a count rather than a
wall of duplicates.

Expand a card to see why it fired:

- The breaching value, against its threshold.
- A snapshot of the surrounding state at that moment — error rate, percentiles,
  throughput, pending jobs, rollbacks, the slowest routes at the time, and the
  top exception.
- The timeline of firings.

**Security** is the audit feed — logins, logouts, authorization denials, and issued tokens — searchable and paged.

**Logs** is every application log entry, level-filterable and request-correlated, rendered like a terminal.

**Queues** shows workers, queue depth and throughput, failed jobs with a retry button, scheduled and delayed jobs, the dead-letter list (jobs that exhausted their retries) with a requeue button, and the slowest jobs. It is live data from `@zerotal/queue` when that package is installed, and degrades to empty otherwise.

**Mail** is the mail log — every message sent, queued, or failed, with its subject, recipients, mailer, render time, and body.

**Notifications** is distinct from Mail: one row per channel delivery (mail, database, slack, sms, broadcast), so a single notification fanned out to three channels shows three rows. Filter by status, search by recipient or channel, page through.

**Database** covers slow queries, N+1 offenders, transaction commit/rollback counts, recent migrations, and a **Model changes** panel with per-model created/updated/deleted counts plus a recent-changes timeline.

**Cache** shows the hit rate, hits and misses, evictions, and the hottest keys.

**Commands** is the log of console command runs — name, exit code, duration, when — from both the CLI and in-process `Artisan.call()`.

**System** is the host view: health checks, CPU/memory/heap gauges, uptime
checks, scheduled-task check-ins and run history, the storage panel (row counts,
oldest record, and the cleanup/export controls), and runtime metadata.

The environment badge in the top bar reads your real `APP_ENV` / `NODE_ENV` —
green in production, amber otherwise. A staging box never lies about being
production.

## How the data flows

Everything is driven by core's `FrameworkEvents` bus, the same synchronous substrate the logger and telemetry read. A single subscriber, installed when the provider boots, maps each event to the right tab. You do not instrument anything: if your code uses the ORM, the cache, the mailer, notifications, the queue, or Flow, the panel already sees it.

| What you see                                                                              | Where it comes from                                                                    |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Requests, latency, throughput, error rate, Apdex, slow routes, per-request user/IP/memory | `RequestHandled` / `RequestFailed`                                                     |
| Per-request SQL (correlated by context) and the N+1 flag                                  | `QueryExecuted` / `NPlusOneDetected`                                                   |
| Exceptions grouped by type and route, with affected users                                 | `RequestFailed`                                                                        |
| Cache hit-rate, hot keys, evictions                                                       | `CacheQueried` / `CacheEvicted`                                                        |
| Mail sent / queued / failed                                                               | `MessageSent` / `MessageQueued` / `MessageFailed`                                      |
| Notifications per channel                                                                 | `NotificationSent`                                                                     |
| Console command runs                                                                      | `CommandRan`                                                                           |
| Model created / updated / deleted                                                         | `ModelChanged`                                                                         |
| Outgoing HTTP per host (calls, p95, error rate)                                           | `OutgoingRequestCompleted`                                                             |
| Job throughput and slowest jobs                                                           | `JobRan`                                                                               |
| Realtime actions with user, IP, queries, memory                                           | `WebSocketConnected` / `WebSocketDisconnected` / `FlowActionHandled`                   |
| Security feed                                                                             | `LoginSucceeded` / `LoginFailed` / `LoggedOut` / `AuthorizationDenied` / `TokenIssued` |
| Application logs                                                                          | the core logger's tap                                                                  |
| Transactions, migrations                                                                  | `TransactionCommitted` / `TransactionRolledBack` / `MigrationRan`                      |
| Scheduled-task run history and check-ins                                                  | `TaskRan` / `TaskFailed` / `TaskSkipped`                                               |
| Queues, workers, failed and dead-letter jobs                                              | `@zerotal/queue`, when installed                                                       |
| Health, gauges, uptime, deploy SHA                                                        | the `Health` registry, the process, and git/env                                        |

For anything that does not flow through the bus — a deploy marker, or a third-party call you make without the `Http` client — the `Monitor` facade records it directly and takes precedence. Every `Monitor.*` call is a safe no-op until the provider boots, so you can call it from anywhere without guarding.

```ts fragment
import { Monitor } from "@zerotal/monitor";

Monitor.recordDeploy(gitSha);
Monitor.recordHttp({ host: "api.stripe.com", ms: 412, error: false });

// Attach metadata to the current request or action — it shows on the trace.
Monitor.context({ tenant: tenant.id, plan: user.plan });
```

## Configuration

Create `config/monitor.ts` with the `MonitorConfig()` helper, which type-checks every field and applies sensible defaults, so you only override what you need.

```ts
// config/monitor.ts
import { MonitorConfig } from "@zerotal/monitor";

export default MonitorConfig({
  path: "/monitor",
  auth: (user) => user?.role === "admin",
});
```

| Field                                  | Default                       | What it does                                                         |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `path`                                 | `/monitor`                    | URL prefix the panel mounts at.                                      |
| `title` / `subtitle`                   | `Super Panel` / `Zerotal Ops` | Branding in the sidebar and tab title.                               |
| `auth`                                 | allow outside production      | The access gate; see below.                                          |
| `record`                               | `true`                        | Install the event recorder. Off means a read-only shell.             |
| `refreshMs`                            | `3000`                        | Live auto-refresh cadence.                                           |
| `apdexTargetMs`                        | `100`                         | Apdex satisfaction threshold (T).                                    |
| `slowQueryMs`                          | `100`                         | Cut-off for a query to count as slow.                                |
| `slowRequestMs`                        | `1000`                        | Cut-off for the Slow requests widget.                                |
| `snapshotCacheMs`                      | `1000`                        | How long to reuse a built snapshot; see Performance.                 |
| `capturePayloads`                      | `false`                       | Capture request/response headers and bodies on the trace (redacted). |
| `payloadMaxBytes`                      | `65536`                       | Truncate captured bodies to this size.                               |
| `storage`                              | `storage/monitor.sqlite`      | The persistence file. Use `:memory:` for ephemeral.                  |
| `retentionDays`                        | `7`                           | History kept before pruning.                                         |
| `retentionMode`                        | `delete`                      | `delete` or `archive` data past retention.                           |
| `metrics` / `metricsPath`              | `true` / `/metrics`           | The Prometheus endpoint.                                             |
| `alerts`                               | `true`                        | Evaluate threshold alerts.                                           |
| `alertThresholds`                      | see Alerts                    | Error rate, p95, queue backlog, rollback limits.                     |
| `alertCooldownMs`                      | `1800000`                     | Minimum gap before the same alert re-fires.                          |
| `alertWebhook`                         | unset                         | Slack-compatible URL to POST firing alerts to.                       |
| `zerotalVersion` / `region` / `deploy` | derived                       | Footer metadata.                                                     |

## Access control

The `auth` callback receives the authenticated user (or `undefined`) and returns whether to allow access. The default permits access only outside production, which is safe for local development but means **you must set an `auth` gate before deploying** — otherwise the panel, which exposes request payloads, user identities, and logs, is unreachable in production by default but wide open the moment you flip the environment. Gate it to an admin role:

```ts fragment
auth: (user) => user?.role === "admin",
```

The same gate protects the JSON export route. The Prometheus endpoint is deliberately outside it (scrapers cannot log in) — protect that one at the network layer instead.

## Alerts

The panel evaluates threshold alerts every fifteen seconds against the live snapshot. Out of the box it watches four signals: the 5xx error rate, p95 latency, total pending jobs across queues, and transaction rollbacks. Tune the limits through `alertThresholds`:

```ts fragment
alertThresholds: { errorRatePct: 5, p95Ms: 2000, queuePending: 500, rolledBackInWindow: 10 },
```

Alerts are edge-triggered — each one fires once when it crosses its threshold and resets when the metric recovers. Because a metric hovering near its limit would otherwise re-fire every time it dips back over, a **cooldown** (`alertCooldownMs`, thirty minutes by default) suppresses re-firing of the same alert within the window. Set it to `0` if you genuinely want a fresh alert on every breach.

When an alert fires it is logged, recorded so the Alerts tab can show it with its full context, and dispatched. There are two ways to be paged. The simplest is a webhook — set `alertWebhook` to a Slack-compatible URL and each firing is POSTed as JSON, no extra dependency. For richer routing, register a handler and wire it to notifications, PagerDuty, or anything else:

```ts fragment
import { onAlert } from "@zerotal/monitor";

onAlert((alert) => {
  // alert: { id, level, title, detail, metric, value, threshold, unit }
  notifyOpsTeam(alert);
});
```

Use the webhook when you just want a message in a channel; use `onAlert` when you need to choose a destination, format a payload, or escalate by severity.

## Prometheus

A Prometheus text-exposition endpoint is served at `/metrics` (configurable, on by default). It exports cumulative HTTP counters, latency/Apdex/cache/queue/WebSocket/exception gauges, system gauges, and per-route latency — ready for Grafana and Alertmanager.

```
zerotal_http_requests_total 1284
zerotal_http_request_duration_ms_p95 318
zerotal_apdex 0.94
zerotal_ws_connections 12
zerotal_route_duration_ms_avg{method="GET",route="/dashboard"} 612
```

## Persistence, retention, and export

The panel writes every sample to `bun:sqlite`, so the **live / 1h / 24h / 7d**
ranges trace real history and survive restarts — not just whatever happened since
boot. Each stream is a timestamped table, and reading a snapshot selects the rows
inside the chosen window, so every tab stays range-consistent.

**Retention.** Data older than `retentionDays` is pruned hourly and on boot. Set
`retentionMode: 'archive'` and the old rows move to `*_archive` tables instead of
being deleted, which keeps them for cold storage.

**The storage panel** on the System tab shows live row counts and the oldest
record, with three controls:

| Control          | What it does                                                |
| ---------------- | ----------------------------------------------------------- |
| **Clean up now** | Prunes past-retention data immediately.                     |
| **Clear all**    | Wipes everything, behind a confirm prompt.                  |
| **Export JSON**  | Downloads the full current snapshot for the selected range. |

The export sits behind the same auth gate as the panel. It is worth knowing about
for incident write-ups, or for diffing state either side of a deploy.

All three are available on the store programmatically, as `store.prune()`,
`store.wipe()`, and `store.snapshot(range)`.

## Theming

The panel is built from [`@zerotal/flow-ui`](/docs/components) and themed with its design tokens, so it follows light and dark mode and looks like the same product as the [admin](/docs/admin) rather than a separate tool. There is no build step: the layout injects the kit's theme, which loads the Tailwind Play CDN and emits the palette inline.

Every colour in the panel resolves to a token — `bg-card`, `text-muted-foreground`, `text-success`, `text-destructive`, `hsl(var(--chart-3))` — so the only thing the monitor overrides is its own orange `--primary`. That one variable recolours the whole panel, and an app can push it further by appending its own token CSS.

Practically, this means re-branding the monitor is a few CSS variables rather than a fork, and a contributed section written against the same tokens matches the built-in ones for free.

## Adding your own sections

The panel owns the shell, the time-range selector, the storage and the retention policy — but it doesn't own the knowledge of what is worth watching about any given package. So it's a **host**: it publishes a write surface as the `monitor.panel` container binding, and a package pushes a section into it at boot.

A section is _described_, not rendered. The contributor returns stats and tables; the panel draws them. That keeps the panel coherent no matter who contributed a section, and means the contributing package needs no JSX and no dependency on `@zerotal/monitor`:

```ts fragment
// In a contributing provider's onBooting()
interface MonitorHost {
  enabled(id: string): boolean;
  section(s: { id: string; label: string; group?: string; resolve(range: string): unknown }): void;
}

const monitor = app.container.tryMake("monitor.panel") as MonitorHost | undefined;
if (!monitor?.enabled("billing")) return;

monitor.section({
  id: "billing",
  label: "Billing",
  group: "Infrastructure",
  resolve: () => ({
    stats: [
      { label: "Failed charges", value: failures.length, tone: failures.length ? "bad" : "good" },
      { label: "Success rate", value: `${rate}%`, percent: rate, tone: "good" },
    ],
    tables: [
      {
        title: "Recent failures",
        columns: [
          { key: "id", label: "Charge", mono: true },
          { key: "reason", label: "Reason" },
          { key: "amount", label: "Amount", align: "end" },
        ],
        rows: failures,
        empty: "No failed charges in this range.",
      },
    ],
  }),
});
```

`resolve` receives the selected range and is called on every render and every auto-refresh, so it should read from what the package already records rather than doing expensive work. A section that throws renders as empty rather than taking the panel down — the monitor has to stay up precisely when the thing it watches is unhealthy.

Declaring the host's shape locally rather than importing it is the point: the package compiles and ships with no dependency on the monitor, and an app that runs it without the panel pulls in nothing extra — the binding simply isn't there and the function returns.

This is the other half of how the recorders already work. A package writes its measurements into `monitor.store` through its own `observability.ts`; a section says what those measurements should look like on screen.

To keep a contributor installed but drop its section, name it in `sections`:

```ts fragment
// config/monitor.ts
export default MonitorConfig({
  sections: { scheduler: false },
});
```

### Scheduled tasks

`@zerotal/scheduler` ships the first contributed section. A cron task that silently stopped firing is one of the harder failures to notice — nothing errors, work just stops happening — so the section leads with counts of tasks that are failing or have never run, then lists every task with its cron expression, last result, duration and next due time. Install both providers and it appears under **Infrastructure**; no configuration.

## Testing

The starter app ships a **Monitoring Lab** at `/lab` that deliberately exercises every observed path, so you can fill the panel with real activity instead of waiting for organic traffic. It lives under `app/flow/pages/(authenticated)/lab`, with the shared scenario logic in `app/services/lab-scenarios.ts`.

The lab page has two kinds of trigger. The buttons run as Flow WebSocket actions, so they populate the Realtime tab as well as whatever they touch — N+1 bursts, cache hits and misses, a model create/update/delete, a mail notification, logs at every level, and a deliberately slow action. The links are full HTTP requests: `/lab/load` runs the whole kitchen sink in one request, `/lab/slow` sleeps for a second and a half to land in Slow requests, and `/lab/boom` throws so you can watch the Exceptions tab group the failure and attribute it to your signed-in user.

Open `/lab` in one tab and `/monitor` in another, click through, and watch each panel light up. It is the fastest way to learn what every tab is showing and to sanity-check a fresh install.

> **Note** — The lab pages are development scaffolding. Delete the `lab` directory and `lab-scenarios.ts` before shipping, or gate them so they never reach production.

## Performance and honest limits

The panel is built to be cheap, but a few things are worth knowing.

Recording never sits on the request hot path. Each `record*` call pushes a row into an in-memory buffer (just an array push, no I/O); a timer flushes batched inserts in one transaction roughly once a second, and a read flushes first so the panel always sees the latest activity. So even under heavy load the monitor adds no synchronous disk write to your responses — the buffer also flushes early if it fills, to bound memory.

Snapshots are cached for `snapshotCacheMs` (one second by default), keyed by range. This de-duplicates the overlapping reads that happen when the panel poll, the alert loop, and a Prometheus scrape all ask for the live snapshot at once, and any action that changes data invalidates the cache immediately so you never see a stale count after clicking. A single operator polling every few seconds sees little benefit; the win is under concurrent access. Set it to `0` to always build fresh.

Per-request and per-action memory is the process heap at completion, not an isolated per-request figure — Bun shares one heap across concurrent work, so treat it as indicative rather than exact. The live queue, scheduler, and health adapters degrade gracefully: if the optional peer package is not installed, that section reads empty rather than throwing. And the panel never invents data — if a number is zero, nothing happened.

## References

`@zerotal/monitor` exports the panel, its provider and config helper, and the
pieces you need to record or read data yourself.

| Export                        | What it is                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `MonitorProvider`             | Registers the panel, the recorders, and the alert loop. Add it to `bootstrap/providers.ts`. |
| `MonitorConfig(shape)`        | Type-checked builder for `config/monitor.ts`.                                               |
| `Monitor`                     | Facade over the live store — read a snapshot or record an event by hand.                    |
| `MonitorStore`                | The buffered store itself, when you need it outside the container.                          |
| `MonitorPanel`                | The panel definition, for contributing your own sections.                                   |
| `renderPrometheus(snapshot)`  | Renders a snapshot in the Prometheus text exposition format.                                |
| `evaluateAlerts(snapshot)`    | Runs the configured thresholds and returns the notices that fired.                          |
| `onAlert(handler)`            | Subscribe to alert notices — route them to Slack, email, or a pager.                        |
| `installMonitorEventBridge()` | Wires framework events into the recorders. The provider calls this for you.                 |
| `MonitorAuthMiddleware`       | Guards the panel route with your `auth` predicate.                                          |
| `MonitorPayloadMiddleware`    | Captures request/response bodies when `capturePayloads` is on.                              |

Types: `MonitorConfigShape`, `ResolvedMonitorConfig`, `MonitorStoreOptions`,
`AlertThresholds`, `AlertNotice`, plus the store's row types.

### Commands

`@zerotal/monitor` ships no CLI commands. The panel is a route, not a console
tool — everything is read through the browser or the Prometheus endpoint.

## Next steps

- [Telemetry](/docs/telemetry) — export the same signal to an OTLP backend for long-term storage.
- [Logger](/docs/logger) — the channels the Logs tab reads from.
- [Health](/docs/health) — the readiness endpoint the panel's Health section surfaces.
- [Devtools](/docs/devtools) — the in-page inspector for a single request, rather than the fleet view.
