/**
 * Configuration for `@zerotal/monitor`, authored in `config/monitor.ts`:
 *
 *   import { MonitorConfig } from "@zerotal/monitor";
 *   export default MonitorConfig({
 *     path: "/monitor",
 *     auth: (user) => user?.role === "admin",
 *   });
 */
import { deepMerge, devSurfacesEnabled } from "@zerotal/core";
import type { RetentionMode } from "./store/MonitorDb.ts";
import type { AlertThresholds } from "./alerting.ts";

export interface MonitorConfigShape {
  /** URL prefix the panel mounts at. Default: `/monitor`. */
  path?: string | undefined;
  /** Browser tab title / sidebar heading. Default: `Super Panel`. */
  title?: string | undefined;
  /** Sub-label under the title. Default: `Zerotal Ops`. */
  subtitle?: string | undefined;
  /**
   * Authorization gate. Receives the authenticated user (or undefined) and
   * must return true to allow access. Default: allow only outside production.
   */
  auth?: ((user: unknown) => boolean | Promise<boolean>) | undefined;
  /** Install the recorder middleware to capture live request data. Default: true. */
  record?: boolean | undefined;
  /** Auto-refresh cadence in milliseconds while "Live" is on. Default: 3000. */
  refreshMs?: number | undefined;
  /** Apdex satisfaction threshold (T) in ms. Default: 100. */
  apdexTargetMs?: number | undefined;
  /** Queries at/above this many ms count as "slow". Default: 100. */
  slowQueryMs?: number | undefined;
  /** Requests at/above this many ms count as "slow" (Slow Requests widget). Default: 1000. */
  slowRequestMs?: number | undefined;
  /**
   * Capture request/response headers and bodies on each request (Telescope-style),
   * shown in the request trace. Off by default — it buffers bodies and is
   * privacy-sensitive. Sensitive headers (authorization/cookie) and body keys
   * (password/token/secret/…) are redacted automatically.
   */
  capturePayloads?: boolean | undefined;
  /** Truncate captured request/response bodies to this many bytes. Default: 65536. */
  payloadMaxBytes?: number | undefined;
  /**
   * Cache built snapshots for this many ms, keyed by range, so overlapping reads
   * (panel poll + Prometheus scrape + alert loop) share one build. Mutating actions
   * invalidate it. Default: 1000. Set `0` to always build fresh.
   */
  snapshotCacheMs?: number | undefined;
  /**
   * SQLite file the panel persists to, so history survives restarts and the
   * 1h/24h/7d ranges trace real data. Default: `storage/monitor.sqlite`. Use
   * `:memory:` for an ephemeral, in-process store.
   */
  storage?: string | undefined;
  /** Days of history to keep before pruning. Default: 7. */
  retentionDays?: number | undefined;
  /** What to do with data past retention: `delete` it or `archive` it. Default: `delete`. */
  retentionMode?: RetentionMode | undefined;
  /**
   * Expose a Prometheus text-exposition endpoint. Default: `false` (opt-in).
   * The endpoint is unauthenticated (a scraper can't satisfy user-auth), so it
   * ships off; enable it only when you protect `metricsPath` at the network
   * layer (firewall/ingress) or scope it to a private interface.
   */
  metrics?: boolean | undefined;
  /** Path for the Prometheus endpoint. Default: `/metrics`. Protect it at the network layer. */
  metricsPath?: string | undefined;
  /** Evaluate threshold alerts on a short interval. Default: `true`. */
  alerts?: boolean | undefined;
  /** Alert thresholds (error rate, queue backlog, p95, rollbacks). */
  alertThresholds?: AlertThresholds | undefined;
  /**
   * Minimum gap (ms) before the same alert can fire again after it recovers and
   * re-breaches. Stops an oscillating metric from re-paging / re-flooding the feed
   * for one ongoing issue. Default: 30 min. Set `0` to fire on every fresh breach.
   */
  alertCooldownMs?: number | undefined;
  /**
   * Slack-compatible webhook URL. When set, every newly-firing alert is POSTed to
   * it as JSON (`{ text, level, title, detail }`) so alerts page someone instead of
   * only lighting up the panel. Dependency-free (uses `fetch`); delivery is
   * best-effort. For richer routing, register a handler with `onAlert()` instead.
   */
  alertWebhook?: string | undefined;
  /** Accent colour (hex) for the panel chrome. Default: Zerotal orange. */
  accent?: string | undefined;
  /** Version string shown in the System footer. */
  zerotalVersion?: string | undefined;
  /** Region label shown in the System footer. */
  region?: string | undefined;
  /** Deploy SHA shown in the System footer. */
  deploy?: string | undefined;
  /**
   * Switch contributed sections off by id — `{ scheduler: false }` keeps the
   * scheduler installed but drops its section from the panel. Anything absent
   * here is on.
   */
  sections?: Record<string, boolean> | undefined;
}

export interface ResolvedMonitorConfig extends MonitorConfigShape {
  path: string;
  title: string;
  subtitle: string;
  record: boolean;
  refreshMs: number;
  apdexTargetMs: number;
  slowQueryMs: number;
  slowRequestMs: number;
  snapshotCacheMs: number;
  storage: string;
  retentionDays: number;
  retentionMode: RetentionMode;
  metrics: boolean;
  metricsPath: string;
  alerts: boolean;
  alertCooldownMs: number;
  capturePayloads: boolean;
  payloadMaxBytes: number;
  accent: string;
  /** Always set after MonitorConfig() applies defaults. */
  auth: (user: unknown) => boolean | Promise<boolean>;
}

// The default gate keys off the framework's own APP_ENV (via the shared
// fail-closed predicate), NOT NODE_ENV — which Bun leaves unset, so a
// documented `APP_ENV=production` deploy would otherwise expose the panel.
// Only explicitly non-prod envs get open-by-default access; everything else
// (unset, staging, production) must supply an explicit `auth` predicate.
const defaultAuthOpen = (): boolean => devSurfacesEnabled();

const defaults: ResolvedMonitorConfig = {
  path: "/monitor",
  title: "Super Panel",
  subtitle: "Zerotal Ops",
  record: true,
  refreshMs: 3000,
  apdexTargetMs: 100,
  slowQueryMs: 100,
  slowRequestMs: 1000,
  snapshotCacheMs: 1000,
  storage: "storage/monitor.sqlite",
  retentionDays: 7,
  retentionMode: "delete",
  metrics: false,
  metricsPath: "/metrics",
  alerts: true,
  alertCooldownMs: 30 * 60 * 1000,
  capturePayloads: false,
  payloadMaxBytes: 65536,
  accent: "#f97316",
  // deepMerge can't carry a function through, so MonitorConfig() reattaches the
  // real predicate; this default keeps the type honest and is the prod-safe gate.
  auth: () => defaultAuthOpen(),
};

export function MonitorConfig(options: Partial<MonitorConfigShape> = {}): ResolvedMonitorConfig {
  const merged = deepMerge(defaults, options) as ResolvedMonitorConfig;
  // deepMerge can't carry a function through; reattach the auth callback.
  if (options.auth) merged.auth = options.auth;
  else if (!merged.auth) merged.auth = () => defaultAuthOpen();
  return merged;
}

declare module "@zerotal/core" {
  interface ConfigRegistry {
    monitor: MonitorConfigShape;
  }
}
