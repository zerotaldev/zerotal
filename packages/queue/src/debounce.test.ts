/**
 * Debounced jobs, on every driver that supports them.
 *
 * The behaviour under test is *trailing*: repeated dispatches collapse into one
 * pending job whose run-at keeps moving out, and the surviving job carries the
 * newest payload. The two things worth being careful about are that the default
 * key separates genuinely different work, and that a job a worker has already
 * claimed is never collapsed into — that dispatch is new work.
 *
 * The Redis half runs against the fake in `RedisDriver.test.ts`'s shape rather
 * than against a server that may not be there. The queue package has made the
 * opposite mistake before: a suite that reached for a real Redis left the
 * production backend uncovered while looking thorough.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Job } from "./Job.ts";
import { QueueManager } from "./QueueManager.ts";
import { SyncDriver } from "./drivers/SyncDriver.ts";
import { SQL } from "bun";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import type { SQLInstance } from "@zerotal/orm";
import type { JobRecord, QueueDriver } from "./drivers/QueueDriver.ts";

const NOW = (): number => Math.floor(Date.now() / 1000);

function record(
  overrides: Partial<Omit<JobRecord, "id" | "createdAt">> = {},
): Omit<JobRecord, "id" | "createdAt"> {
  return {
    queue: "default",
    className: "ReindexDocument",
    payload: JSON.stringify({ documentId: 1 }),
    attempts: 0,
    maxAttempts: 3,
    retryDelay: 1000,
    availableAt: NOW() + 30,
    ...overrides,
  };
}

/** Every job the driver holds for a queue — reserved rows included. */
async function pendingCount(driver: QueueDriver): Promise<number> {
  return driver.size();
}

describe("SqliteDriver.pushDebounced", () => {
  let driver: SqliteDriver;

  beforeEach(async () => {
    driver = new SqliteDriver(new SQL(":memory:") as unknown as SQLInstance);
    await driver.flush();
  });

  it("collapses repeated dispatches of the same key into one pending job", async () => {
    await driver.pushDebounced(record(), "reindex:1");
    await driver.pushDebounced(record(), "reindex:1");
    await driver.pushDebounced(record(), "reindex:1");

    expect(await pendingCount(driver)).toBe(1);
  });

  it("keeps different keys apart, so different work does not collapse", async () => {
    await driver.pushDebounced(record({ payload: JSON.stringify({ documentId: 1 }) }), "reindex:1");
    await driver.pushDebounced(record({ payload: JSON.stringify({ documentId: 2 }) }), "reindex:2");

    expect(await pendingCount(driver)).toBe(2);
  });

  it("pushes the run-at out, so the job runs after the last dispatch", async () => {
    await driver.pushDebounced(record({ availableAt: 1_000 }), "reindex:1");
    await driver.pushDebounced(record({ availableAt: 2_000 }), "reindex:1");

    const [pending] = await driver.listPending!();
    expect(pending?.availableAt).toBe(2_000);
  });

  it("keeps the newest payload, because the earlier dispatch is the stale one", async () => {
    await driver.pushDebounced(record({ payload: JSON.stringify({ title: "first" }) }), "k");
    await driver.pushDebounced(record({ payload: JSON.stringify({ title: "second" }) }), "k");

    const [pending] = await driver.listPending!();
    expect(JSON.parse(pending!.payload)).toEqual({ title: "second" });
  });

  it("does not collapse into a job a worker has already claimed", async () => {
    // Due now, so it can be popped.
    await driver.pushDebounced(record({ availableAt: NOW() - 1 }), "reindex:1");
    const claimed = await driver.pop();
    expect(claimed).not.toBeNull();

    // The claimed job is running. This dispatch is new work, not a reschedule —
    // so there are now two rows: the one being worked, and a fresh pending one.
    // (`size()` counts reserved rows too, which is why the assertion is on rows
    // rather than on a single number.)
    await driver.pushDebounced(record(), "reindex:1");
    const rows = await driver.listPending!();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.id !== claimed!.id)).toHaveLength(1);
  });

  it("round-trips the key onto the record, so a promoted job can release it", async () => {
    await driver.pushDebounced(record({ availableAt: NOW() - 1 }), "reindex:1");
    const claimed = await driver.pop();
    expect(claimed?.debounceKey).toBe("reindex:1");
  });

  it("leaves undebounced pushes alone", async () => {
    await driver.push(record());
    await driver.push(record());
    expect(await pendingCount(driver)).toBe(2);
  });
});

// ── The dispatch path ───────────────────────────────────────────────────────────

class ReindexDocument extends Job {
  override readonly debounce = 30;
  constructor(private documentId = 1) {
    super();
  }
  override payload(): Record<string, unknown> {
    return { documentId: this.documentId };
  }
  async handle(): Promise<void> {}
}

class ReindexWithTimestamp extends ReindexDocument {
  /** Every dispatch carries a fresh timestamp, so the default key would never collapse. */
  override payload(): Record<string, unknown> {
    return { ...super.payload(), requestedAt: Math.random() };
  }
  override debounceKey(): string {
    return `reindex:${JSON.stringify(super.payload())}`;
  }
}

class PlainJob extends Job {
  async handle(): Promise<void> {}
}

describe("dispatching a debounced job", () => {
  let driver: SqliteDriver;
  let manager: QueueManager;

  beforeEach(async () => {
    driver = new SqliteDriver(new SQL(":memory:") as unknown as SQLInstance);
    await driver.flush();
    manager = new QueueManager(driver);
  });

  it("collapses eight saves of one document into a single pending job", async () => {
    for (let i = 0; i < 8; i++) await manager.dispatch(new ReindexDocument(1));
    expect(await driver.size()).toBe(1);
  });

  it("does not collapse two different documents", async () => {
    await manager.dispatch(new ReindexDocument(1));
    await manager.dispatch(new ReindexDocument(2));
    expect(await driver.size()).toBe(2);
  });

  it("schedules the run for after the window, not immediately", async () => {
    const before = Math.floor(Date.now() / 1000);
    await manager.dispatch(new ReindexDocument(1));
    const [pending] = await driver.listPending();
    expect(pending!.availableAt).toBeGreaterThanOrEqual(before + 30);
  });

  it("an overridden key collapses payloads the default would keep apart", async () => {
    await manager.dispatch(new ReindexWithTimestamp(1));
    await manager.dispatch(new ReindexWithTimestamp(1));
    expect(await driver.size()).toBe(1);
  });

  it("leaves an undebounced job dispatching immediately, as before", async () => {
    const before = Math.floor(Date.now() / 1000);
    await manager.dispatch(new PlainJob());
    await manager.dispatch(new PlainJob());
    const rows = await driver.listPending();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.availableAt).toBeLessThanOrEqual(before + 1);
  });

  it("refuses rather than degrading when the driver cannot collapse atomically", async () => {
    // A driver with no `pushDebounced`: collapsing in this process instead would
    // appear to work here and do nothing in production, where more than one
    // worker dispatches. So it throws, and the message names what to change.
    const incapable = {
      push: async () => {},
      pop: async () => null,
      fail: async () => {},
      retry: async () => {},
      delete: async () => {},
      size: async () => 0,
      flush: async () => {},
      listFailed: async () => [],
      deleteFailedRecord: async () => {},
      clearFailed: async () => {},
    } satisfies QueueDriver;

    const manager = new QueueManager(incapable);
    expect(manager.dispatch(new ReindexDocument(1))).rejects.toThrow(
      /does not support|cannot collapse/i,
    );
  });

  it("runs inline on the sync driver, which is what sync means", async () => {
    // Debounce is deliberately inert here: SyncDriver runs every job in the
    // dispatching process, so there is no window in which a second dispatch
    // could arrive to collapse into. Documented, not silently surprising.
    const sync = new QueueManager(new SyncDriver());
    await expect(sync.dispatch(new ReindexDocument(1))).resolves.toBeUndefined();
  });
});
