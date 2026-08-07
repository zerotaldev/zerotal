import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { MonitorStore } from "./MonitorStore.ts";

describe("MonitorStore persistence", () => {
  // A fresh file per test so WAL artifacts from one can't bleed into the next.
  let path = "";
  beforeEach(() => {
    path = `${tmpdir()}/zerotal-monitor-${Date.now()}-${Math.floor(Math.random() * 1e9)}.sqlite`;
  });
  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(path + suffix, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("persists across a restart — a new store on the same file sees prior data", async () => {
    const s1 = new MonitorStore({ storage: path });
    s1.recordRequest({ method: "GET", path: "/posts", status: 200, ms: 12 });
    s1.recordQuery({ sql: "SELECT * FROM posts", ms: 30 });
    expect((await s1.snapshot("7d")).requests.length).toBe(1);
    s1.dispose();

    // Simulate a process restart: brand-new store, same SQLite file.
    const s2 = new MonitorStore({ storage: path });
    const snap = await s2.snapshot("7d");
    expect(snap.requests.length).toBe(1);
    expect(snap.requests[0]!.path).toBe("/posts");
    expect(snap.storage.requests).toBe(1);
    s2.dispose();
  });

  it("wipe() clears persisted data", async () => {
    const s = new MonitorStore({ storage: path });
    s.recordRequest({ method: "GET", path: "/x", status: 200, ms: 5 });
    expect((await s.snapshot("7d")).requests.length).toBe(1);
    expect(s.wipe()).toBeGreaterThan(0);
    expect((await s.snapshot("7d")).requests.length).toBe(0);
    s.dispose();
  });

  it("derives slow requests, top users, and top-memory routes", async () => {
    const s = new MonitorStore({ storage: ":memory:", slowRequestMs: 500 });
    s.recordRequest({
      method: "GET",
      path: "/fast",
      status: 200,
      ms: 20,
      user: "a@x.com",
      memKb: 1000,
    });
    s.recordRequest({
      method: "GET",
      path: "/slow",
      status: 200,
      ms: 1200,
      user: "a@x.com",
      memKb: 8000,
    });
    s.recordRequest({
      method: "POST",
      path: "/slow",
      status: 200,
      ms: 700,
      user: "b@x.com",
      memKb: 4000,
    });

    const snap = await s.snapshot("1h");

    // Slow requests: ms >= 500, slowest first.
    expect(snap.slowRequests.map((r) => r.path)).toEqual(["/slow", "/slow"]);
    expect(snap.slowRequests[0]!.ms).toBe(1200);

    // Application usage: a@x.com made 2 requests, b@x.com 1.
    expect(snap.topUsers[0]).toEqual({ id: "a@x.com", requests: 2 });
    expect(snap.topUsers.find((u) => u.id === "b@x.com")?.requests).toBe(1);

    // Top memory: GET /slow peaked at 8000 KB.
    expect(snap.topMemory[0]!.memKb).toBe(8000);
    expect(snap.topMemory[0]!.path).toBe("/slow");

    // Row carries the new per-request fields.
    const row = snap.requests.find((r) => r.path === "/slow" && r.method === "GET");
    expect(row!.user).toBe("a@x.com");
    expect(row!.memKb).toBe(8000);
    s.dispose();
  });

  it("derives security, N+1, transactions, and realtime feeds from recorded events", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordEvent({
      kind: "auth",
      label: "login.failed",
      status: "warn",
      route: "web",
      data: { user: "x", detail: "bad password" },
    });
    s.recordEvent({
      kind: "nplus",
      label: "select * from posts where id = ?",
      status: "warn",
      route: "/posts",
      data: { count: 12 },
    });
    s.recordEvent({
      kind: "ws",
      label: "action",
      status: "ok",
      route: "Counter",
      data: { component: "Counter", action: "increment", ms: 8 },
    });
    s.recordEvent({ kind: "tx", label: "rolledback", status: "warn", data: { ms: 30 } });
    s.recordEvent({ kind: "cache_evict", label: "k", status: "info", data: { detail: "ttl" } });
    s.recordJob({ status: "completed", className: "SendMail", queue: "default", ms: 1200 });

    const snap = await s.snapshot("live");
    expect(snap.security.some((e) => e.label === "login.failed")).toBe(true);
    expect(snap.nplusOnes[0]!.worstCount).toBe(12);
    expect(snap.realtime.components[0]!.name).toBe("Counter");
    expect(snap.realtime.actionsPerMin).toBeGreaterThan(0);
    expect(snap.transactions.rolledBack).toBe(1);
    expect(snap.cache.evictions).toBe(1);
    expect(snap.slowJobs[0]!.className).toBe("SendMail");
    expect(snap.slowJobs[0]!.ms).toBe(1200);
    s.dispose();
  });

  it("captures per-WS-action context (user, ip, queries) like a request", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordEvent({
      kind: "ws",
      label: "action",
      status: "ok",
      route: "Counter",
      data: {
        component: "Counter",
        action: "increment",
        ms: 8,
        ok: true,
        user: "u@x.com",
        ip: "1.2.3.4",
        nplus: false,
        nQueries: 2,
        queries: [
          { ms: 3, sql: "SELECT 1" },
          { ms: 1, sql: "SELECT 2" },
        ],
      },
    });
    const snap = await s.snapshot("live");
    const a = snap.realtime.recentActions[0]!;
    expect(a.id).toBeGreaterThan(0); // stable id (recorded timestamp) for the expandable row
    expect(a.component).toBe("Counter");
    expect(a.action).toBe("increment");
    expect(a.user).toBe("u@x.com");
    expect(a.ip).toBe("1.2.3.4");
    expect(a.queries).toHaveLength(2);
    expect(a.queries[0]!.sql).toBe("SELECT 1");
    s.dispose();
  });

  it("attaches Monitor.context() metadata and surfaces a logs feed", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordRequest({
      method: "GET",
      path: "/dashboard",
      status: 200,
      ms: 10,
      user: "a@x.com",
      context: { tenant: "acme", plan: "pro" },
    });
    s.recordEvent({
      kind: "log",
      label: "warn",
      status: "warn",
      route: "req-1",
      data: { detail: "disk almost full" },
    });
    s.recordEvent({ kind: "log", label: "info", status: "info", data: { detail: "cache warmed" } });

    const snap = await s.snapshot("live");
    const row = snap.requests.find((r) => r.path === "/dashboard");
    expect(row!.context.tenant).toBe("acme");
    expect(row!.context.plan).toBe("pro");

    expect(snap.logs.length).toBe(2);
    const warn = snap.logs.find((l) => l.label === "warn");
    expect(warn!.detail).toBe("disk almost full");
    s.dispose();
  });

  it("snapshot exposes storage counts for the System tab", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordRequest({ method: "GET", path: "/a", status: 200, ms: 5 });
    s.recordCache(true, "k");
    s.recordCache(false, "k");
    const snap = await s.snapshot("live");
    expect(snap.storage.requests).toBe(1);
    expect(snap.storage.cacheEvents).toBe(2);
    expect(snap.cache.hits).toBe(1);
    expect(snap.cache.misses).toBe(1);
    s.dispose();
  });

  it("groups persisted alert firings with their captured context", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    // Two firings of the same alert id collapse into one grouped entry with a count.
    s.recordEvent({
      kind: "alert",
      label: "Slow responses",
      status: "bad",
      route: "p95-latency",
      data: {
        id: "p95-latency",
        level: "critical",
        detail: "p95 is 5019ms",
        metric: "p95 latency",
        value: 5019,
        threshold: 2000,
        unit: "ms",
        context: { p95: 5019, errorRate: 0.5, pending: 3 },
      },
    });
    s.recordEvent({
      kind: "alert",
      label: "Slow responses",
      status: "bad",
      route: "p95-latency",
      data: {
        id: "p95-latency",
        level: "critical",
        detail: "p95 is 5020ms",
        metric: "p95 latency",
        value: 5020,
        threshold: 2000,
        unit: "ms",
        context: { p95: 5020 },
      },
    });
    s.recordEvent({
      kind: "alert",
      label: "Queue backlog",
      status: "warn",
      route: "queue-backlog",
      data: {
        id: "queue-backlog",
        level: "warning",
        detail: "900 pending",
        metric: "pending jobs",
        value: 900,
        threshold: 500,
        unit: "",
      },
    });
    // A non-alert event must not leak in.
    s.recordEvent({ kind: "log", label: "info", status: "info", data: { detail: "noise" } });

    const snap = await s.snapshot("live");
    // Two distinct alert kinds (the two p95 firings collapse into one), critical first.
    expect(snap.alertHistory).toHaveLength(2);
    const p95 = snap.alertHistory[0]!;
    expect(p95.id).toBe("p95-latency");
    expect(p95.level).toBe("critical");
    expect(p95.count).toBe(2);
    expect(p95.value).toBe(5020); // latest firing
    expect(p95.metric).toBe("p95 latency");
    expect(p95.unit).toBe("ms");
    expect(p95.context.p95).toBe(5020);
    expect(p95.occurrences).toHaveLength(2);
    expect(snap.alertHistory.find((a) => a.id === "queue-backlog")!.count).toBe(1);
    s.dispose();
  });

  it("aggregates a single route's latency, errors, and status breakdown", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordRequest({ method: "GET", path: "/posts", status: 200, ms: 40, user: "a@x.com" });
    s.recordRequest({ method: "GET", path: "/posts", status: 200, ms: 120 });
    s.recordRequest({ method: "GET", path: "/posts", status: 500, ms: 900 });
    s.recordRequest({ method: "GET", path: "/posts", status: 404, ms: 30 });
    // A different route must not contaminate the drill-in.
    s.recordRequest({ method: "POST", path: "/posts", status: 201, ms: 10 });
    s.recordRequest({ method: "GET", path: "/other", status: 200, ms: 5 });

    const d = await s.routeDetail("get", "/posts", "1h");
    expect(d.method).toBe("GET");
    expect(d.path).toBe("/posts");
    expect(d.total).toBe(4);
    expect(d.errorCount).toBe(1); // only the 500
    expect(d.errorRate).toBe(25);
    expect(d.maxMs).toBe(900);
    expect(d.p95).toBeGreaterThan(0);

    const byClass = Object.fromEntries(d.statusDist.map((c) => [c.label, c.count]));
    expect(byClass["2xx"]).toBe(2);
    expect(byClass["4xx"]).toBe(1);
    expect(byClass["5xx"]).toBe(1);
    expect(byClass["3xx"]).toBeUndefined(); // empty classes are dropped

    expect(d.slowest[0]!.ms).toBe(900);
    expect(d.recent.length).toBe(4);
    s.dispose();
  });

  it("returns an empty route detail when the route has no traffic", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    const d = await s.routeDetail("GET", "/nope", "live");
    expect(d.total).toBe(0);
    expect(d.errorRate).toBe(0);
    expect(d.statusDist).toEqual([]);
    expect(d.recent).toEqual([]);
    s.dispose();
  });

  it("derives notifications, commands, and per-model change counts", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordEvent({
      kind: "notification",
      label: "OrderShipped",
      status: "ok",
      route: "mail",
      data: { channel: "mail", to: "a@x.com", ms: 12 },
    });
    s.recordEvent({
      kind: "notification",
      label: "OrderShipped",
      status: "bad",
      route: "sms",
      data: { channel: "sms", to: "a@x.com", ms: 5, detail: "no number" },
    });
    s.recordEvent({
      kind: "command",
      label: "cache:clear",
      status: "ok",
      data: { ms: 30, code: 0 },
    });
    s.recordEvent({ kind: "command", label: "migrate", status: "bad", data: { ms: 100, code: 1 } });
    s.recordEvent({
      kind: "model",
      label: "User",
      status: "info",
      route: "created",
      data: { table: "users", op: "created" },
    });
    s.recordEvent({
      kind: "model",
      label: "User",
      status: "info",
      route: "created",
      data: { table: "users", op: "created" },
    });
    s.recordEvent({
      kind: "model",
      label: "User",
      status: "info",
      route: "updated",
      data: { table: "users", op: "updated" },
    });
    s.recordEvent({
      kind: "model",
      label: "Post",
      status: "info",
      route: "deleted",
      data: { table: "posts", op: "deleted" },
    });

    const snap = await s.snapshot("live");

    expect(snap.notifications).toHaveLength(2);
    expect(snap.notifications.find((n) => n.channel === "mail")!.recipient).toBe("a@x.com");
    expect(snap.notifications.find((n) => n.channel === "sms")!.status).toBe("bad");

    expect(snap.commands).toHaveLength(2);
    expect(snap.commands.find((c) => c.name === "migrate")!.code).toBe(1);
    expect(snap.commands.find((c) => c.name === "cache:clear")!.status).toBe("ok");

    const user = snap.models.find((m) => m.model === "User")!;
    expect(user.created).toBe(2);
    expect(user.updated).toBe(1);
    expect(user.deleted).toBe(0);
    expect(user.total).toBe(3);
    expect(user.table).toBe("users");
    expect(snap.models.find((m) => m.model === "Post")!.deleted).toBe(1);

    // Recent-changes timeline carries every model event, newest first.
    expect(snap.recentModels).toHaveLength(4);
    expect(snap.recentModels.some((m) => m.model === "Post" && m.operation === "deleted")).toBe(
      true,
    );
    s.dispose();
  });

  it("derives real per-queue throughput and trend from recorded job runs", async () => {
    const fakeQueue = {
      queues: async () => [{ queue: "default", pending: 3 }],
      failed: async () => [],
    };
    const app = { container: { tryMake: (n: string) => (n === "queue" ? fakeQueue : null) } };
    const s = new MonitorStore({ storage: ":memory:" });
    s.bindApp(app as never);

    for (let i = 0; i < 6; i++) {
      s.recordJob({ status: "completed", className: "SendInvoice", queue: "default", ms: 10 });
    }

    const snap = await s.snapshot("live"); // 60s window → 6 runs ≈ 6/min
    const q = snap.queues.find((row) => row.name === "default")!;
    expect(q.pending).toBe(3); // depth from the queue manager
    expect(q.throughput).toBe(6); // derived from job runs, no longer a fake zero
    expect(q.series.some((v) => v > 0)).toBe(true); // real trend
    s.dispose();
  });

  it("surfaces exhausted jobs as the dead-letter list from the live queue", async () => {
    const fakeQueue = {
      failed: async () => [
        {
          id: 1,
          queue: "default",
          className: "SendInvoice",
          attempts: 3,
          maxAttempts: 3,
          error: "boom",
          failedAt: "2m ago",
        },
        {
          id: 2,
          queue: "default",
          className: "Retryable",
          attempts: 1,
          maxAttempts: 3,
          error: "transient",
          failedAt: "1m ago",
        },
      ],
    };
    const app = { container: { tryMake: (n: string) => (n === "queue" ? fakeQueue : null) } };
    const s = new MonitorStore({ storage: ":memory:" });
    s.bindApp(app as never);

    const snap = await s.snapshot("live");
    // Only the job that exhausted maxAttempts is dead-lettered.
    expect(snap.deadLetter).toHaveLength(1);
    expect(snap.deadLetter[0]!.name).toBe("SendInvoice");
    expect(snap.deadLetter[0]!.attempts).toBe(3);

    // Requeuing drops it from the view on the next snapshot.
    await s.requeueDead(1);
    const after = await s.snapshot("live");
    expect(after.deadLetter).toHaveLength(0);
    s.dispose();
  });

  it("captures per-WS-action memory and exposes the connected-clients list", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordEvent({
      kind: "ws",
      label: "action",
      status: "ok",
      route: "Counter",
      data: { component: "Counter", action: "inc", ms: 8, memKb: 4096 },
    });

    const snap = await s.snapshot("live");
    expect(snap.realtime.recentActions[0]!.memKb).toBe(4096);
    expect(snap.realtime.avgMemKb).toBe(4096);
    // No live WS server in the test → an empty (but present) client list, never a throw.
    expect(Array.isArray(snap.realtime.clients)).toBe(true);
    s.dispose();
  });

  it("surfaces scheduled task run history", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordEvent({ kind: "task", label: "backup:run", status: "ok", data: { ms: 40 } });
    s.recordEvent({
      kind: "task",
      label: "report:send",
      status: "bad",
      data: { ms: 12, detail: "smtp down" },
    });

    const snap = await s.snapshot("live");
    expect(snap.scheduledRuns).toHaveLength(2);
    expect(snap.scheduledRuns.some((e) => e.label === "backup:run" && e.status === "ok")).toBe(
      true,
    );
    expect(snap.scheduledRuns.find((e) => e.label === "report:send")!.status).toBe("bad");
    s.dispose();
  });

  it("caches snapshots within the TTL and invalidates on mutation", async () => {
    const s = new MonitorStore({ storage: ":memory:", snapshotCacheMs: 5000 });
    s.recordRequest({ method: "GET", path: "/a", status: 200, ms: 5 });

    const a = await s.snapshot("live");
    const b = await s.snapshot("live");
    expect(b).toBe(a); // same reference → served from cache

    // A different range is cached independently.
    const c = await s.snapshot("1h");
    expect(c).not.toBe(a);

    // A mutating action busts the cache, so the next read rebuilds.
    s.wipe();
    const d = await s.snapshot("live");
    expect(d).not.toBe(a);
    s.dispose();
  });

  it("does not cache when snapshotCacheMs is 0 (the default)", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    const a = await s.snapshot("live");
    const b = await s.snapshot("live");
    expect(b).not.toBe(a); // fresh build every read
    s.dispose();
  });

  it("round-trips captured request/response payloads on the trace", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordRequest({
      method: "POST",
      path: "/orders",
      status: 201,
      ms: 30,
      payload: {
        reqHeaders: { "content-type": "application/json", authorization: "[redacted]" },
        reqBody: '{"item":"book","password":"[redacted]"}',
        resBody: '{"id":7}',
      },
    });
    const snap = await s.snapshot("live");
    const row = snap.requests.find((r) => r.path === "/orders");
    expect(row!.payload).not.toBeNull();
    expect(row!.payload!.reqHeaders.authorization).toBe("[redacted]");
    expect(row!.payload!.reqBody).toContain('"password":"[redacted]"');
    expect(row!.payload!.resBody).toBe('{"id":7}');

    // A request recorded without a payload reports null, not a stub.
    s.recordRequest({ method: "GET", path: "/health", status: 200, ms: 2 });
    const snap2 = await s.snapshot("live");
    expect(snap2.requests.find((r) => r.path === "/health")!.payload).toBeNull();
    s.dispose();
  });

  it("exposes a live pulse with in-flight requests and connection count", async () => {
    const { beginHttp, endHttp } = await import("@zerotal/core/metrics");
    const s = new MonitorStore({ storage: ":memory:" });

    beginHttp();
    beginHttp();
    const snap = await s.snapshot("live");
    expect(snap.pulse.activeRequests).toBe(2); // in-flight gauge
    expect(snap.pulse.activeConnections).toBe(0); // no WS server in the test
    expect(typeof snap.pulse.requestsPerSec).toBe("number");
    expect(typeof snap.pulse.errorRatePct).toBe("number");
    endHttp();
    endHttp();
    s.dispose();
  });

  it("counts distinct affected users per exception group", async () => {
    const s = new MonitorStore({ storage: ":memory:" });
    s.recordException({ type: "TypeError", message: "boom" }, "/checkout", "alice@x.com");
    s.recordException({ type: "TypeError", message: "boom" }, "/checkout", "bob@x.com");
    s.recordException({ type: "TypeError", message: "boom" }, "/checkout", "alice@x.com"); // dup
    s.recordException({ type: "TypeError", message: "boom" }, "/checkout", null); // anonymous

    const snap = await s.snapshot("live");
    const grp = snap.exceptions.find((e) => e.type === "TypeError");
    expect(grp!.count).toBe(4);
    expect(grp!.users).toBe(2); // alice + bob; duplicate collapsed, anonymous excluded
    s.dispose();
  });
});
