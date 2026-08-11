/**
 * The Prometheus exposition output.
 *
 * This is the one surface here that a machine parses rather than a person reads,
 * and a scraper rejects a malformed line without telling the application. The
 * risky parts are therefore the two escapers: a route label carrying a quote or a
 * backslash, and a system gauge whose name is not a valid metric identifier. Both
 * come from application data — a URL and a label — so neither is hypothetical.
 */
import { describe, it, expect } from "bun:test";
import { renderPrometheus } from "./prometheus.ts";
import type { MonitorSnapshot } from "./store/types.ts";

/** A snapshot carrying every field the exporter reads; overridable per test. */
function snapshot(over: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    apdex: 0.98,
    cache: { hitRate: 91.5, evictions: 3 },
    gauges: [],
    slowRoutes: [],
    realtime: { actionsPerMin: 0, avgActionMs: 0, activeConnections: 0 },
    queues: [],
    exceptions: [],
    failedJobs: [],
    nplusOnes: [],
    transactions: { committed: 0, rolledBack: 0 },
    ...(over as object),
  } as unknown as MonitorSnapshot;
}

/** Every non-comment, non-blank line — i.e. the actual samples. */
function samples(text: string): string[] {
  return text.split("\n").filter((l) => l && !l.startsWith("#"));
}

describe("renderPrometheus — exposition format", () => {
  it("ends with a trailing newline, as the format requires", () => {
    expect(renderPrometheus(snapshot()).endsWith("\n")).toBe(true);
  });

  it("emits HELP and TYPE before each metric it declares", () => {
    const text = renderPrometheus(snapshot());
    for (const name of ["zerotal_http_requests_total", "zerotal_apdex", "zerotal_cache_hit_rate"]) {
      expect(text).toContain(`# HELP ${name} `);
      expect(text).toContain(`# TYPE ${name} `);
    }
  });

  it("gives every sample line a name and a numeric value", () => {
    for (const line of samples(renderPrometheus(snapshot({ apdex: 0.5 })))) {
      // `name value` or `name{labels} value` — the value must parse as a number,
      // because a scraper drops the whole response over one bad sample.
      const value = line.slice(line.lastIndexOf(" ") + 1);
      expect(Number.isNaN(Number(value)), `non-numeric value in: ${line}`).toBe(false);
    }
  });

  it("declares counters as counters and windowed values as gauges", () => {
    const text = renderPrometheus(snapshot());
    expect(text).toContain("# TYPE zerotal_http_requests_total counter");
    expect(text).toContain("# TYPE zerotal_apdex gauge");
  });
});

describe("renderPrometheus — label escaping", () => {
  it("escapes quotes and backslashes in a route label", () => {
    // A path containing a quote would otherwise close the label early and produce
    // a line no scraper can parse.
    const text = renderPrometheus(
      snapshot({
        slowRoutes: [{ method: 'GE"T', path: 'C:\\bad"path', ms: 12 }],
      } as Partial<MonitorSnapshot>),
    );
    const line = samples(text).find((l) => l.includes("zerotal_route_duration_ms_avg"))!;
    expect(line).toContain('method="GE\\"T"');
    expect(line).toContain('route="C:\\\\bad\\"path"');
  });

  it("flattens a newline in a label rather than splitting the sample across lines", () => {
    const text = renderPrometheus(
      snapshot({
        slowRoutes: [{ method: "GET", path: "/a\n/b", ms: 5 }],
      } as Partial<MonitorSnapshot>),
    );
    const routeLines = samples(text).filter((l) => l.startsWith("zerotal_route_duration_ms_avg"));
    // One route in, exactly one sample line out.
    expect(routeLines).toHaveLength(1);
    expect(routeLines[0]).toContain("/a /b");
  });

  it("writes HELP and TYPE once for the labelled route metric, not per route", () => {
    const text = renderPrometheus(
      snapshot({
        slowRoutes: [
          { method: "GET", path: "/a", ms: 1 },
          { method: "GET", path: "/b", ms: 2 },
        ],
      } as Partial<MonitorSnapshot>),
    );
    const help = text
      .split("\n")
      .filter((l) => l.startsWith("# HELP zerotal_route_duration_ms_avg"));
    expect(help).toHaveLength(1);
    expect(samples(text).filter((l) => l.startsWith("zerotal_route_duration_ms_avg"))).toHaveLength(
      2,
    );
  });

  it("omits the route metric entirely when there are no routes", () => {
    expect(renderPrometheus(snapshot())).not.toContain("zerotal_route_duration_ms_avg");
  });
});

describe("renderPrometheus — metric names", () => {
  it("sanitises a gauge label into a valid metric name", () => {
    // Gauge labels are display strings ("Heap Used", "CPU %"); a metric name may
    // only contain [a-zA-Z0-9_:].
    const text = renderPrometheus(
      snapshot({ gauges: [{ label: "Heap Used %", value: 41 }] } as Partial<MonitorSnapshot>),
    );
    const line = samples(text).find((l) => l.startsWith("zerotal_system_"))!;
    const name = line.slice(0, line.indexOf(" "));
    expect(name).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/);
    expect(name).toBe("zerotal_system_heap_used___percent");
  });
});
