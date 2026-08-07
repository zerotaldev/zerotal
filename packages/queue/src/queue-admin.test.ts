import { describe, it, expect, beforeEach } from "bun:test";
import { SQL } from "bun";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { QueueManager, queueStats } from "./QueueManager.ts";

type Any = any;

function record(queue: string, className: string, attempts = 0, maxAttempts = 3) {
  return {
    queue,
    className,
    payload: '{"a":1}',
    attempts,
    maxAttempts,
    retryDelay: 0,
    availableAt: Math.floor(Date.now() / 1000),
    batchId: undefined,
  };
}

describe("Queue admin introspection", () => {
  let driver: SqliteDriver;
  let mgr: QueueManager;

  beforeEach(() => {
    const db = new SQL(":memory:") as unknown as Any;
    driver = new SqliteDriver(db);
    mgr = new QueueManager(driver);
  });

  it("listPending + queues report pending depth per queue", async () => {
    await driver.push(record("default", "X"));
    await driver.push(record("emails", "Y"));
    await driver.push(record("emails", "Z"));

    const pending = await mgr.pending();
    expect(pending).toHaveLength(3);

    const queues = await mgr.queues();
    expect(queues.find((q) => q.queue === "default")!.pending).toBe(1);
    expect(queues.find((q) => q.queue === "emails")!.pending).toBe(2);
  });

  it("paginates pending jobs", async () => {
    for (let i = 0; i < 5; i++) await driver.push(record("default", `J${i}`));
    const firstTwo = await mgr.pending("default", 2, 0);
    const nextTwo = await mgr.pending("default", 2, 2);
    expect(firstTwo).toHaveLength(2);
    expect(nextTwo).toHaveLength(2);
    expect(firstTwo[0]!.id).not.toBe(nextTwo[0]!.id);
  });

  it("retryFailed re-dispatches and clears the failed row", async () => {
    await driver.push(record("default", "X", 0, 1));
    const popped = await driver.pop("default");
    await driver.fail(popped!, "boom");

    expect(await mgr.failed()).toHaveLength(1);
    const failedId = (await mgr.failed())[0]!.id;

    expect(await mgr.retryFailed(failedId)).toBe(true);
    expect(await mgr.failed()).toHaveLength(0);
    expect(await mgr.pending()).toHaveLength(1);
  });

  it("forgetFailed + clearFailed remove failed rows", async () => {
    await driver.push(record("default", "X", 0, 1));
    const popped = await driver.pop("default");
    await driver.fail(popped!, "boom");
    const id = (await mgr.failed())[0]!.id;

    await mgr.forgetFailed(id);
    expect(await mgr.failed()).toHaveLength(0);

    await driver.push(record("default", "Y", 0, 1));
    const p2 = await driver.pop("default");
    await driver.fail(p2!, "boom2");
    await mgr.clearFailed();
    expect(await mgr.failed()).toHaveLength(0);
  });

  it("stats() returns numeric throughput counters", () => {
    const s = mgr.stats();
    for (const k of ["processedTotal", "failedTotal", "processedLast5m", "failedLast5m"] as const) {
      expect(typeof s[k]).toBe("number");
    }
    expect(typeof queueStats().processedTotal).toBe("number");
  });
});
