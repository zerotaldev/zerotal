import { describe, it, expect, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Job } from "./Job.ts";
import { JobRegistry } from "./JobRegistry.ts";
import { QueueManager } from "./QueueManager.ts";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { Bus } from "./Bus.ts";

// ── Shared log collector ───────────────────────────────────────────────────

const log: string[] = [];

// ── Job fixtures ───────────────────────────────────────────────────────────

class StepJob extends Job {
  constructor(public readonly label: string) {
    super();
  }
  payload() {
    return { label: this.label };
  }
  static fromPayload(p: Record<string, unknown>) {
    return new StepJob(p.label as string);
  }
  async handle() {
    log.push(`step:${this.label}`);
  }
}

class AlwaysFailJob extends Job {
  readonly maxAttempts = 1;
  async handle() {
    throw new Error("intentional");
  }
}

class NotifyJob extends Job {
  constructor(public readonly kind: string) {
    super();
  }
  payload() {
    return { kind: this.kind };
  }
  static fromPayload(p: Record<string, unknown>) {
    return new NotifyJob(p.kind as string);
  }
  async handle() {
    log.push(`notify:${this.kind}`);
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

function makeManager(): QueueManager {
  const db = new SQL(":memory:") as unknown as SQLInstance;
  const driver = new SqliteDriver(db);
  return new QueueManager(driver);
}

async function drainAll(manager: QueueManager, queue = "default", limit = 20): Promise<void> {
  let processed = 0;
  while (processed < limit) {
    const did = await manager.processNext(queue);
    if (!did) break;
    processed++;
  }
}

beforeEach(() => {
  log.length = 0;
  JobRegistry.register(StepJob as never);
  JobRegistry.register(AlwaysFailJob as never);
  JobRegistry.register(NotifyJob as never);
  Bus.reset();
});

// ── Bus.batch() ────────────────────────────────────────────────────────────

describe("Bus.batch()", () => {
  it("throws when Bus is not initialized", () => {
    expect(() => Bus.batch([])).toThrow("not initialized");
  });

  it("dispatchBatch() throws when driver has no batch support", async () => {
    const { SyncDriver } = await import("./drivers/SyncDriver.ts");
    const manager = new QueueManager(new SyncDriver());
    Bus.setManager(manager);
    await expect(Bus.batch([new StepJob("x")]).dispatch()).rejects.toThrow("does not support");
  });

  it("creates a batch with correct initial state", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    const batch = await Bus.batch([new StepJob("a"), new StepJob("b")])
      .name("test-batch")
      .dispatch();

    expect(batch.name).toBe("test-batch");
    expect(batch.totalJobs).toBe(2);
    expect(batch.pendingJobs).toBe(2);
    expect(batch.failedJobs).toBe(0);
    expect(batch.finished()).toBe(false);
    expect(batch.progress()).toBeCloseTo(0);
  });

  it("marks batch as complete after all jobs succeed", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    const batch = await Bus.batch([new StepJob("a"), new StepJob("b")]).dispatch();
    await drainAll(manager);

    const updated = await (manager as unknown as { _driver: SqliteDriver })._driver.getBatch!(
      batch.id,
    );
    expect(updated!.finishedAt).toBeDefined();
    expect(updated!.failedJobs).toBe(0);
    expect(updated!.pendingJobs).toBe(0);
    expect(log).toContain("step:a");
    expect(log).toContain("step:b");
  });

  it("dispatches .then() callbacks when all jobs succeed", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    await Bus.batch([new StepJob("a"), new StepJob("b")])
      .then(new NotifyJob("success"))
      .dispatch();

    await drainAll(manager, "default", 10);

    expect(log).toContain("step:a");
    expect(log).toContain("step:b");
    expect(log).toContain("notify:success");
  });

  it("dispatches .catch() when a job fails and .then() is skipped", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    await Bus.batch([new StepJob("ok"), new AlwaysFailJob()])
      .then(new NotifyJob("success"))
      .catch(new NotifyJob("failure"))
      .dispatch();

    await drainAll(manager, "default", 10);

    expect(log).toContain("step:ok");
    expect(log).toContain("notify:failure");
    expect(log).not.toContain("notify:success");
  });

  it("always dispatches .finally() regardless of outcome", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    // Success path
    await Bus.batch([new StepJob("x")])
      .finally(new NotifyJob("done-success"))
      .dispatch();
    await drainAll(manager, "default", 10);
    expect(log).toContain("notify:done-success");

    log.length = 0;

    // Failure path
    const manager2 = makeManager();
    Bus.setManager(manager2);
    await Bus.batch([new AlwaysFailJob()]).finally(new NotifyJob("done-fail")).dispatch();
    await drainAll(manager2, "default", 10);
    expect(log).toContain("notify:done-fail");
  });

  it("tracks failed job IDs", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    const batch = await Bus.batch([new AlwaysFailJob()]).dispatch();
    await drainAll(manager);

    const updated = await (manager as unknown as { _driver: SqliteDriver })._driver.getBatch!(
      batch.id,
    );
    expect(updated!.failedJobs).toBe(1);
    expect(updated!.failedJobIds.length).toBe(1);
    expect(typeof updated!.failedJobIds[0]).toBe("number");
  });

  it("progress() returns 0..1 as jobs complete", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    const batch = await Bus.batch([
      new StepJob("a"),
      new StepJob("b"),
      new StepJob("c"),
    ]).dispatch();
    expect(batch.progress()).toBeCloseTo(0);

    // Process one job
    await manager.processNext();
    const after1 = await (manager as unknown as { _driver: SqliteDriver })._driver.getBatch!(
      batch.id,
    );
    const p1 = after1 ? (3 - after1.pendingJobs) / 3 : 0;
    expect(p1).toBeCloseTo(1 / 3);

    await drainAll(manager);
    const final = await (manager as unknown as { _driver: SqliteDriver })._driver.getBatch!(
      batch.id,
    );
    expect(final!.pendingJobs).toBe(0);
  });
});

// ── Bus.chain() ────────────────────────────────────────────────────────────

describe("Bus.chain()", () => {
  it("throws when Bus is not initialized", () => {
    expect(() => Bus.chain([])).toThrow("not initialized");
  });

  it("dispatches an empty chain without error", async () => {
    const manager = makeManager();
    Bus.setManager(manager);
    await Bus.chain([]).dispatch();
    expect(log).toEqual([]);
  });

  it("runs a single job", async () => {
    const manager = makeManager();
    Bus.setManager(manager);
    await Bus.chain([new StepJob("only")]).dispatch();
    await drainAll(manager);
    expect(log).toEqual(["step:only"]);
  });

  it("runs jobs in sequence, one after the other", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    await Bus.chain([new StepJob("first"), new StepJob("second"), new StepJob("third")]).dispatch();
    await drainAll(manager);

    expect(log).toEqual(["step:first", "step:second", "step:third"]);
  });

  it("stops the chain when a job fails", async () => {
    const manager = makeManager();
    Bus.setManager(manager);

    await Bus.chain([new StepJob("before"), new AlwaysFailJob(), new StepJob("after")]).dispatch();
    await drainAll(manager);

    expect(log).toContain("step:before");
    expect(log).not.toContain("step:after");
  });
});
