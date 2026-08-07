import { describe, it, expect } from "bun:test";
import { evaluateAlerts, alertsToFire, onAlert, _dispatchAlert } from "./alerting.ts";
import type { AlertNotice } from "./alerting.ts";
import type { MonitorSnapshot } from "./store/types.ts";

function snap(over: Partial<MonitorSnapshot>): MonitorSnapshot {
  return {
    statCards: [{ label: "Error rate", value: "0.0%", delta: 0, series: [] }],
    percentiles: [
      { label: "p50", value: 10 },
      { label: "p95", value: 50 },
      { label: "p99", value: 90 },
    ],
    queues: [],
    transactions: { committed: 0, rolledBack: 0, avgMs: 0 },
    ...over,
  } as unknown as MonitorSnapshot;
}

describe("evaluateAlerts", () => {
  it("is quiet when everything is healthy", () => {
    expect(evaluateAlerts(snap({}))).toHaveLength(0);
  });

  it("fires (critical) on a high error rate", () => {
    const a = evaluateAlerts(
      snap({ statCards: [{ label: "Error rate", value: "12.0%", delta: 0, series: [] }] }),
      { errorRatePct: 5 },
    );
    expect(a[0]!.id).toBe("error-rate");
    expect(a[0]!.level).toBe("critical"); // 12% > 2× threshold
  });

  it("fires on slow p95 and queue backlog", () => {
    const a = evaluateAlerts(
      snap({
        percentiles: [
          { label: "p50", value: 10 },
          { label: "p95", value: 3000 },
          { label: "p99", value: 5000 },
        ],
        queues: [
          { name: "default", pending: 900, wait: 0, throughput: 0, paused: false, series: [] },
        ],
      }),
      { p95Ms: 2000, queuePending: 500 },
    );
    const ids = a.map((x) => x.id).sort();
    expect(ids).toEqual(["p95-latency", "queue-backlog"]);
  });

  it("dispatches fired alerts to registered handlers", () => {
    const seen: string[] = [];
    const off = onAlert((al) => seen.push(al.id));
    _dispatchAlert({
      id: "x",
      level: "warning",
      title: "t",
      detail: "d",
      metric: "m",
      value: 1,
      threshold: 0,
      unit: "",
    });
    expect(seen).toEqual(["x"]);
    off();
    _dispatchAlert({
      id: "y",
      level: "warning",
      title: "t",
      detail: "d",
      metric: "m",
      value: 1,
      threshold: 0,
      unit: "",
    });
    expect(seen).toEqual(["x"]); // unsubscribed
  });
});

describe("alertsToFire — edge-trigger + cooldown", () => {
  const mk = (id: string): AlertNotice => ({
    id,
    level: "warning",
    title: id,
    detail: "",
    metric: "",
    value: 0,
    threshold: 0,
    unit: "",
  });

  it("fires a newly-breaching alert once, then not again while still firing", () => {
    const firing = new Set<string>();
    const last = new Map<string, number>();
    const active = [mk("p95")];
    expect(alertsToFire(active, firing, last, 1000, 60_000).map((a) => a.id)).toEqual(["p95"]);
    // Still active next tick → already in the episode, no re-fire.
    expect(alertsToFire(active, firing, last, 1100, 60_000)).toEqual([]);
  });

  it("suppresses a re-fire within the cooldown after the alert recovers", () => {
    const firing = new Set<string>();
    const last = new Map<string, number>();
    const active = [mk("p95")];

    alertsToFire(active, firing, last, 0, 60_000); // fires at t=0
    firing.delete("p95"); // recovered

    // Re-breach at t=30s — inside the 60s cooldown → suppressed, but marked firing.
    expect(alertsToFire(active, firing, last, 30_000, 60_000)).toEqual([]);
    expect(firing.has("p95")).toBe(true);

    firing.delete("p95"); // recovered again
    // Re-breach at t=70s — past the cooldown → fires again.
    expect(alertsToFire(active, firing, last, 70_000, 60_000).map((a) => a.id)).toEqual(["p95"]);
  });

  it("re-fires on every fresh breach when cooldown is disabled (0)", () => {
    const firing = new Set<string>();
    const last = new Map<string, number>();
    const active = [mk("p95")];
    alertsToFire(active, firing, last, 0, 0);
    firing.delete("p95");
    expect(alertsToFire(active, firing, last, 1, 0).map((a) => a.id)).toEqual(["p95"]);
  });
});
