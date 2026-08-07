/**
 * Threshold-based alerting over the live snapshot. The provider evaluates these
 * on a short interval; a newly-firing alert is logged, recorded (so it shows in
 * the panel), and dispatched to any handlers registered via {@link onAlert} —
 * wire those to `@zerotal/notifications`, Slack, PagerDuty, etc.
 *
 * Alerts are edge-triggered: each fires once when it crosses its threshold and
 * resets when it recovers, so handlers aren't spammed every tick.
 */
import type { MonitorSnapshot } from "./store/types.ts";

export interface AlertThresholds {
  /** Fire when the 5xx rate exceeds this %. Default: 5. */
  errorRatePct?: number;
  /** Fire when pending jobs across queues exceed this. Default: 500. */
  queuePending?: number;
  /** Fire when p95 latency exceeds this many ms. Default: 2000. */
  p95Ms?: number;
  /** Fire when transaction rollbacks in the window exceed this. Default: 10. */
  rolledBackInWindow?: number;
}

export interface AlertNotice {
  id: string;
  level: "warning" | "critical";
  title: string;
  detail: string;
  /** Human label for the breaching metric, e.g. "p95 latency". */
  metric: string;
  /** Observed value at firing time. */
  value: number;
  /** Configured threshold it crossed. */
  threshold: number;
  /** Unit for value/threshold: "ms" | "%" | "". */
  unit: string;
}

const DEFAULTS: Required<AlertThresholds> = {
  errorRatePct: 5,
  queuePending: 500,
  p95Ms: 2000,
  rolledBackInWindow: 10,
};

/** Evaluate the snapshot against thresholds; returns the currently-breaching alerts. */
export function evaluateAlerts(
  snap: MonitorSnapshot,
  thresholds: AlertThresholds = {},
): AlertNotice[] {
  const t = { ...DEFAULTS, ...thresholds };
  const out: AlertNotice[] = [];

  const errCard = snap.statCards.find((c) => c.label === "Error rate");
  const errRate = errCard ? parseFloat(errCard.value) || 0 : 0;
  if (errRate > t.errorRatePct) {
    out.push({
      id: "error-rate",
      level: errRate > t.errorRatePct * 2 ? "critical" : "warning",
      title: "Elevated error rate",
      detail: `${errRate.toFixed(1)}% of requests are 5xx (threshold ${t.errorRatePct}%).`,
      metric: "error rate",
      value: +errRate.toFixed(1),
      threshold: t.errorRatePct,
      unit: "%",
    });
  }

  const p95 = snap.percentiles.find((p) => p.label === "p95")?.value ?? 0;
  if (p95 > t.p95Ms) {
    out.push({
      id: "p95-latency",
      level: p95 > t.p95Ms * 2 ? "critical" : "warning",
      title: "Slow responses",
      detail: `p95 latency is ${p95}ms (threshold ${t.p95Ms}ms).`,
      metric: "p95 latency",
      value: p95,
      threshold: t.p95Ms,
      unit: "ms",
    });
  }

  const pending = snap.queues.reduce((a, q) => a + q.pending, 0);
  if (pending > t.queuePending) {
    out.push({
      id: "queue-backlog",
      level: "warning",
      title: "Queue backlog",
      detail: `${pending} jobs pending across ${snap.queues.length} queues (threshold ${t.queuePending}).`,
      metric: "pending jobs",
      value: pending,
      threshold: t.queuePending,
      unit: "",
    });
  }

  if (snap.transactions.rolledBack > t.rolledBackInWindow) {
    out.push({
      id: "tx-rollbacks",
      level: "warning",
      title: "Transaction rollbacks",
      detail: `${snap.transactions.rolledBack} rollbacks in the window (threshold ${t.rolledBackInWindow}).`,
      metric: "rollbacks",
      value: snap.transactions.rolledBack,
      threshold: t.rolledBackInWindow,
      unit: "",
    });
  }

  return out;
}

/**
 * Decide which currently-breaching alerts should actually fire now.
 *
 * Edge-triggered + cooldown: an alert fires when it first crosses its threshold,
 * and won't fire again within `cooldownMs` even if it recovers and re-breaches.
 * This stops an oscillating metric (e.g. p95 hovering around the limit) from
 * paging an operator — or flooding the feed — every time it dips back over.
 *
 * Mutates `firing` (the in-flight episode set) and `lastFired` (id → timestamp)
 * in place, and returns the subset of `active` to record/dispatch. Pass `now` so
 * the decision is deterministic and testable; `cooldownMs <= 0` disables cooldown
 * (re-fire on every fresh breach).
 */
export function alertsToFire(
  active: AlertNotice[],
  firing: Set<string>,
  lastFired: Map<string, number>,
  now: number,
  cooldownMs: number,
): AlertNotice[] {
  const toFire: AlertNotice[] = [];
  for (const a of active) {
    if (firing.has(a.id)) continue; // already firing this episode
    firing.add(a.id);
    const last = lastFired.get(a.id);
    // Suppress only when it HAS fired before and is still within the cooldown.
    if (last !== undefined && cooldownMs > 0 && now - last < cooldownMs) continue;
    lastFired.set(a.id, now);
    toFire.push(a);
  }
  return toFire;
}

// ── Handler registry ────────────────────────────────────────────────────────────

type AlertHandler = (alert: AlertNotice) => void | Promise<void>;
const _handlers: AlertHandler[] = [];

/**
 * Register a handler called once whenever a monitor alert fires. Returns an
 * unsubscribe function. Wire it to notifications:
 *
 *   onAlert((a) => Notification.route("slack", SLACK_URL).notify(new MonitorAlert(a)));
 */
export function onAlert(fn: AlertHandler): () => void {
  _handlers.push(fn);
  return () => {
    const i = _handlers.indexOf(fn);
    if (i >= 0) _handlers.splice(i, 1);
  };
}

/** @internal — fan an alert out to registered handlers (errors swallowed). */
export function _dispatchAlert(alert: AlertNotice): void {
  for (const h of _handlers) {
    try {
      void h(alert);
    } catch {
      /* a handler must never break alerting */
    }
  }
}
