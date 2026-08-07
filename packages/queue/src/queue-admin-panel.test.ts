import { describe, it, expect, beforeEach } from "bun:test";
import { SQL } from "bun";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { QueueManager } from "./QueueManager.ts";
import { installQueueAdmin } from "./admin.ts";
import type { Application } from "@zerotal/core";

type Any = any;

/** A console as the panel receives it, loosened for assertions. */
type Console = {
  slug: string;
  title: string;
  ability: string;
  navigationBadge?: () => Promise<string | number | null>;
  tabs: Array<{
    key: string;
    label: string;
    rows: () => Promise<Record<string, unknown>[]>;
    badge?: () => Promise<number | null>;
    rowActions?: Array<{ key: string; run: (row: Record<string, unknown>) => Promise<unknown> }>;
    headerActions?: Array<{ key: string; run: () => Promise<unknown> }>;
  }>;
};

/**
 * Stand in for an app whose container may or may not hold the panel binding —
 * the only thing `installQueueAdmin` reaches for.
 */
function fakeApp(bindings: Record<string, unknown>): Application {
  return {
    container: { tryMake: (key: string) => bindings[key] ?? null },
  } as unknown as Application;
}

function panelSpy(enabled = true) {
  const consoles: Console[] = [];
  return {
    consoles,
    sink: {
      enabled: () => enabled,
      console: (c: Console) => consoles.push(c),
    },
  };
}

function record(queue: string, className: string, attempts = 0) {
  return {
    queue,
    className,
    payload: '{"a":1}',
    attempts,
    maxAttempts: 3,
    retryDelay: 0,
    availableAt: Math.floor(Date.now() / 1000),
    batchId: undefined,
  };
}

describe("installQueueAdmin", () => {
  it("contributes nothing when no admin panel is installed", () => {
    // Nothing to assert but the absence of a throw — the point is that a queue
    // without the panel never touches it.
    expect(() => installQueueAdmin(fakeApp({}))).not.toThrow();
  });

  it("contributes nothing when the app switched the queue plugin off", () => {
    const spy = panelSpy(false);
    installQueueAdmin(fakeApp({ "admin.panel": spy.sink }));
    expect(spy.consoles).toHaveLength(0);
  });

  it("registers a jobs console with the failed / pending / queues tabs", () => {
    const spy = panelSpy();
    installQueueAdmin(fakeApp({ "admin.panel": spy.sink }));

    const console = spy.consoles[0]!;
    expect(console.slug).toBe("jobs");
    expect(console.ability).toBe("queue.view");
    expect(console.tabs.map((t) => t.key)).toEqual(["failed", "pending", "queues", "throughput"]);
  });
});

describe("queue console data", () => {
  let driver: SqliteDriver;
  let mgr: QueueManager;
  let console: Console;

  beforeEach(() => {
    const db = new SQL(":memory:") as unknown as Any;
    driver = new SqliteDriver(db);
    mgr = new QueueManager(driver);

    const spy = panelSpy();
    installQueueAdmin(fakeApp({ "admin.panel": spy.sink }));
    console = spy.consoles[0]!;
  });

  it("describes the failed tab over the driver's failed records", async () => {
    await driver.push(record("default", "SendInvoice"));
    const job = await driver.pop("default");
    await driver.fail(job!, "boom");

    const failed = await mgr.failed();
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBe("boom");
  });

  it("exposes retry and forget as row actions on the failed tab", () => {
    const failedTab = console.tabs.find((t) => t.key === "failed")!;
    expect(failedTab.rowActions?.map((a) => a.key)).toEqual(["retry", "forget"]);
    expect(failedTab.headerActions?.map((a) => a.key)).toEqual(["clear-failed"]);
  });

  it("offers flush on the pending tab and nothing destructive on queues", () => {
    const pending = console.tabs.find((t) => t.key === "pending")!;
    const queues = console.tabs.find((t) => t.key === "queues")!;
    expect(pending.headerActions?.map((a) => a.key)).toEqual(["flush"]);
    expect(queues.headerActions).toBeUndefined();
    expect(queues.rowActions).toBeUndefined();
  });

  it("reports throughput counters as rows", async () => {
    const tab = console.tabs.find((t) => t.key === "throughput")!;
    const rows = await tab.rows();
    expect(rows.map((r) => r["metric"])).toEqual([
      "Processed (total)",
      "Processed (last 5m)",
      "Failed (total)",
      "Failed (last 5m)",
    ]);
  });
});
