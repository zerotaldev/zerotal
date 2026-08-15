import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Job } from "./Job.ts";
import { Batch } from "./Batch.ts";
import { Bus as BusClass } from "./Bus.ts";
import { withApp } from "@zerotal/core";
import { JobRegistry } from "./JobRegistry.ts";
import { QueueManager } from "./QueueManager.ts";
import { FrameworkEvents } from "@zerotal/core";
import { JobRan } from "./events.ts";
import { QueueFake } from "./QueueFake.ts";
import { SyncDriver } from "./drivers/SyncDriver.ts";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { SQL } from "bun";
import { QueueConfig } from "./config.ts";

type GreetPayload = { name: string };

class GreetJob extends Job {
  static calls: string[] = [];

  constructor(public readonly name: string) {
    super();
  }

  payload(): GreetPayload {
    return { name: this.name };
  }

  static fromPayload(p: Record<string, unknown>): GreetJob {
    return new GreetJob(p["name"] as string);
  }

  async handle(): Promise<void> {
    GreetJob.calls.push(this.name);
  }
}

class FailingJob extends Job {
  readonly maxAttempts = 2;
  static failCount = 0;

  async handle(): Promise<void> {
    FailingJob.failCount++;
    throw new Error("intentional failure");
  }
}

// ── Job base class ─────────────────────────────────────────────────────

class MinimalJob extends Job {
  async handle(): Promise<void> {}
}

describe("Job", () => {
  it("className returns the constructor name", () => {
    expect(new GreetJob("x").className).toBe("GreetJob");
  });

  it("payload() returns serializable data", () => {
    expect(new GreetJob("Alice").payload()).toEqual({ name: "Alice" });
  });

  it("payload() default implementation returns empty object", () => {
    expect(new MinimalJob().payload()).toEqual({});
  });

  it('default queue is "default"', () => {
    expect(new GreetJob("x").queue).toBe("default");
  });

  it("className returns correct name for unnamed subclass", () => {
    expect(new MinimalJob().className).toBe("MinimalJob");
  });
});

// ── JobRegistry ─────────────────────────────────────────────────────────

describe("JobRegistry", () => {
  it("register() and resolve() work correctly", () => {
    JobRegistry.register(GreetJob as never);
    expect(JobRegistry.resolve("GreetJob")).toBe(GreetJob);
  });

  it("resolve() returns undefined for unknown class", () => {
    expect(JobRegistry.resolve("NonExistentJob")).toBeUndefined();
  });
});

// ── QueueManager (SyncDriver) ───────────────────────────────────────────

describe("QueueManager — SyncDriver", () => {
  let manager: QueueManager;

  beforeEach(() => {
    GreetJob.calls = [];
    FailingJob.failCount = 0;
    JobRegistry.register(GreetJob as never);
    JobRegistry.register(FailingJob as never);
    manager = new QueueManager(new SyncDriver());
  });

  it("dispatch() executes job immediately in sync mode", async () => {
    await manager.dispatch(new GreetJob("Alice"));
    expect(GreetJob.calls).toContain("Alice");
  });

  it("dispatch() executes multiple jobs in order", async () => {
    await manager.dispatch(new GreetJob("Alice"));
    await manager.dispatch(new GreetJob("Bob"));
    expect(GreetJob.calls).toEqual(["Alice", "Bob"]);
  });

  it("failing job is retried up to maxAttempts", async () => {
    const job = new FailingJob();
    try {
      await manager.dispatch(job);
    } catch {
      /* expected to throw — we assert on failCount below */
    }
    expect(FailingJob.failCount).toBeGreaterThan(0);
  });

  it("drain() resolves immediately when no jobs are active", async () => {
    const start = Date.now();
    await manager.drain();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("isShuttingDown prevents new dispatch after drain()", async () => {
    void manager.drain();
    await expect(manager.dispatch(new GreetJob("Late"))).rejects.toThrow("shutting down");
  });
});

// ── SqliteDriver ───────────────────────────────────────────────────────

describe("SqliteDriver", () => {
  let db: SQLInstance;
  let driver: SqliteDriver;

  beforeEach(async () => {
    db = new SQL(":memory:") as unknown as SQLInstance;
    driver = new SqliteDriver(db);
    await driver.flush();
  });

  it("push() and size() work correctly", async () => {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    expect(await driver.size("default")).toBe(1);
  });

  it("pop() returns and removes a job", async () => {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: JSON.stringify({ name: "Test" }),
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    const job = await driver.pop("default");
    expect(job).not.toBeNull();
    expect(job?.className).toBe("GreetJob");
  });

  it("pop() returns null when queue is empty", async () => {
    expect(await driver.pop("default")).toBeNull();
  });

  it("pop() does not return jobs before availableAt", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: future,
    });
    expect(await driver.pop("default")).toBeNull();
  });

  it("delete() removes a job after processing", async () => {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    const job = await driver.pop("default");
    await driver.delete(job!);
    expect(await driver.size("default")).toBe(0);
  });

  it("fail() moves job to failed table", async () => {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 3,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    const job = await driver.pop("default");
    await driver.fail(job!, "test error");
    expect(await driver.size("default")).toBe(0);
  });

  it("flush() clears all jobs", async () => {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    await driver.flush();
    expect(await driver.size("default")).toBe(0);
  });
});

// ── SqliteDriver — failed job management ──────────────────────────────────────

describe("SqliteDriver — failed job management", () => {
  let db: SQLInstance;
  let driver: SqliteDriver;

  beforeEach(async () => {
    db = new SQL(":memory:") as unknown as SQLInstance;
    driver = new SqliteDriver(db);
    await driver.flush();
  });

  async function pushAndFail(): Promise<void> {
    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: JSON.stringify({ name: "T" }),
      attempts: 3,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    const job = await driver.pop("default");
    await driver.fail(job!, "boom");
  }

  it("listFailed() returns all failed jobs", async () => {
    await pushAndFail();
    const list = await driver.listFailed();
    expect(list).toHaveLength(1);
    expect(list[0]!.className).toBe("GreetJob");
    expect(list[0]!.error).toBe("boom");
  });

  it("listFailed() filters by queue", async () => {
    await pushAndFail();
    expect(await driver.listFailed("default")).toHaveLength(1);
    expect(await driver.listFailed("emails")).toHaveLength(0);
  });

  it("deleteFailedRecord() removes a single failed job", async () => {
    await pushAndFail();
    const list = await driver.listFailed();
    await driver.deleteFailedRecord(list[0]!.id);
    expect(await driver.listFailed()).toHaveLength(0);
  });

  it("clearFailed() without queue removes all failed jobs", async () => {
    await pushAndFail();
    await pushAndFail();
    await driver.clearFailed();
    expect(await driver.listFailed()).toHaveLength(0);
  });

  it("clearFailed() with queue only removes that queue's jobs", async () => {
    await pushAndFail();
    // push one to a different queue
    await driver.push({
      queue: "emails",
      className: "GreetJob",
      payload: "{}",
      attempts: 1,
      maxAttempts: 1,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });
    const emailJob = await driver.pop("emails");
    await driver.fail(emailJob!, "other error");

    await driver.clearFailed("emails");
    const remaining = await driver.listFailed();
    expect(remaining.every((r) => r.queue !== "emails")).toBe(true);
    expect(remaining.some((r) => r.queue === "default")).toBe(true);
  });
});

// ── QueueFake — assertions ────────────────────────────────────────────────────

describe("QueueFake", () => {
  let dispatched: Job[] = [];

  // Minimal fake that doesn't need Application; test assertions directly.
  function makeFake(): QueueFake {
    const fake = Object.create(QueueFake.prototype) as QueueFake;
    (fake as unknown as { _dispatched: Job[] })._dispatched = dispatched;
    return fake;
  }

  beforeEach(() => {
    dispatched = [];
    JobRegistry.register(GreetJob as never);
  });

  it("dispatch() captures the job without executing it", async () => {
    const fake = makeFake();
    GreetJob.calls = [];
    await fake.dispatch(new GreetJob("Alice"));
    expect(GreetJob.calls).toHaveLength(0);
    expect(fake.dispatched()).toHaveLength(1);
  });

  it("assertDispatched() passes when the job was dispatched", () => {
    dispatched.push(new GreetJob("Alice"));
    const fake = makeFake();
    expect(() => fake.assertDispatched(GreetJob)).not.toThrow();
  });

  it("assertDispatched() throws when job was not dispatched", () => {
    const fake = makeFake();
    expect(() => fake.assertDispatched(GreetJob)).toThrow("GreetJob");
  });

  it("assertDispatched() with filter passes when filter matches", () => {
    dispatched.push(new GreetJob("Alice"));
    const fake = makeFake();
    expect(() => fake.assertDispatched(GreetJob, (j) => j.name === "Alice")).not.toThrow();
  });

  it("assertDispatched() with filter throws when filter doesn't match", () => {
    dispatched.push(new GreetJob("Alice"));
    const fake = makeFake();
    expect(() => fake.assertDispatched(GreetJob, (j) => j.name === "Bob")).toThrow();
  });

  it("assertNotDispatched() passes when job was not dispatched", () => {
    const fake = makeFake();
    expect(() => fake.assertNotDispatched(GreetJob)).not.toThrow();
  });

  it("assertNotDispatched() throws when job was dispatched", () => {
    dispatched.push(new GreetJob("Alice"));
    const fake = makeFake();
    expect(() => fake.assertNotDispatched(GreetJob)).toThrow("GreetJob");
  });

  it("assertNothingDispatched() passes on empty queue", () => {
    const fake = makeFake();
    expect(() => fake.assertNothingDispatched()).not.toThrow();
  });

  it("assertNothingDispatched() throws when anything was dispatched", () => {
    dispatched.push(new GreetJob("X"));
    const fake = makeFake();
    expect(() => fake.assertNothingDispatched()).toThrow();
  });

  it("assertDispatchedCount() passes for correct count", () => {
    dispatched.push(new GreetJob("A"), new GreetJob("B"));
    const fake = makeFake();
    expect(() => fake.assertDispatchedCount(2)).not.toThrow();
  });

  it("assertDispatchedCount() throws for wrong count", () => {
    dispatched.push(new GreetJob("A"));
    const fake = makeFake();
    expect(() => fake.assertDispatchedCount(3)).toThrow("3");
  });
});

// ── SyncDriver — extended coverage ────────────────────────────────────────────

describe("SyncDriver — delete/size/flush/listFailed/clearFailed", () => {
  const pushRecord = async (driver: SyncDriver, queue = "default") =>
    driver.push({
      queue,
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });

  it("delete() is a no-op (job already consumed by pop)", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await expect(driver.delete(record!)).resolves.toBeUndefined();
  });

  it("size() returns the number of pending jobs", async () => {
    const driver = new SyncDriver();
    expect(await driver.size()).toBe(0);
    await pushRecord(driver);
    expect(await driver.size()).toBe(1);
  });

  it("flush() clears both pending and failed arrays", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await driver.fail(record!, "boom");
    await driver.flush();
    expect(await driver.size()).toBe(0);
    expect(driver.failedJobs).toHaveLength(0);
  });

  it("failedJobs getter returns failed entries", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await driver.fail(record!, "exploded");
    expect(driver.failedJobs).toHaveLength(1);
    expect(driver.failedJobs[0]!.error).toBe("exploded");
  });

  it("listFailed() returns all failed records", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await driver.fail(record!, "err");
    const list = await driver.listFailed();
    expect(list).toHaveLength(1);
    expect(list[0]!.className).toBe("GreetJob");
  });

  it("listFailed(queue) filters by queue name", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver, "mail");
    await pushRecord(driver, "default");
    const r1 = await driver.pop();
    const r2 = await driver.pop();
    await driver.fail(r1!, "e1");
    await driver.fail(r2!, "e2");
    const mailList = await driver.listFailed("mail");
    expect(mailList).toHaveLength(1);
    expect(mailList[0]!.queue).toBe("mail");
  });

  it("deleteFailedRecord() removes entry at 1-based index", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await driver.fail(record!, "err");
    expect(driver.failedJobs).toHaveLength(1);
    await driver.deleteFailedRecord(1);
    expect(driver.failedJobs).toHaveLength(0);
  });

  it("clearFailed() removes all failed entries", async () => {
    const driver = new SyncDriver();
    await pushRecord(driver);
    const record = await driver.pop();
    await driver.fail(record!, "err");
    await driver.clearFailed();
    expect(driver.failedJobs).toHaveLength(0);
  });

  it("clearFailed(queue) only removes entries for that queue", async () => {
    const driver = new SyncDriver();
    for (const q of ["default", "mail"]) {
      await pushRecord(driver, q);
      const r = await driver.pop();
      await driver.fail(r!, "err");
    }
    await driver.clearFailed("mail");
    expect(driver.failedJobs).toHaveLength(1);
    expect(driver.failedJobs[0]!.record.queue).toBe("default");
  });
});

// ── QueueFake — stub interface methods ────────────────────────────────────────

describe("QueueFake — stub interface methods", () => {
  function makeBareFake(): QueueFake {
    const fake = Object.create(QueueFake.prototype) as QueueFake;
    (fake as unknown as Record<string, unknown>)["_dispatched"] = [];
    return fake;
  }

  it("isShuttingDown is always false", () => {
    expect(makeBareFake().isShuttingDown).toBe(false);
  });

  it("processNext() resolves to false", async () => {
    expect(await makeBareFake().processNext()).toBe(false);
  });

  it("drain() resolves without error", async () => {
    await expect(makeBareFake().drain()).resolves.toBeUndefined();
  });

  it("size() returns count of captured jobs", async () => {
    const fake = makeBareFake();
    expect(await fake.size()).toBe(0);
    await fake.dispatch(new GreetJob("Alice"));
    expect(await fake.size()).toBe(1);
  });

  it("flush() clears captured jobs", async () => {
    const fake = makeBareFake();
    await fake.dispatch(new GreetJob("Bob"));
    await fake.flush();
    expect(await fake.size()).toBe(0);
  });
});

// ── FrameworkEvents — JobRan ──────────────────────────────────────────────────

describe("FrameworkEvents — JobRan", () => {
  it("fires when a job is dispatched", async () => {
    const statuses: string[] = [];
    const unsub = FrameworkEvents.on(JobRan, (e) => statuses.push(e.status));
    JobRegistry.register(GreetJob as never);
    const manager = new QueueManager(new SyncDriver());
    await manager.dispatch(new GreetJob("Alice"));
    unsub();
    expect(statuses).toContain("dispatched");
  });

  it("unsub() stops events from firing", async () => {
    const fired: string[] = [];
    const unsub = FrameworkEvents.on(JobRan, () => fired.push("fired"));
    unsub();
    const manager = new QueueManager(new SyncDriver());
    await manager.dispatch(new GreetJob("Alice"));
    expect(fired).toHaveLength(0);
  });

  it("subscriber exception is swallowed — dispatch still resolves", async () => {
    const unsub = FrameworkEvents.on(JobRan, () => {
      throw new Error("boom");
    });
    const manager = new QueueManager(new SyncDriver());
    await expect(manager.dispatch(new GreetJob("Alice"))).resolves.toBeUndefined();
    unsub();
  });
});

// ── QueueManager — setWorkerPool ──────────────────────────────────────────────

describe("QueueManager.setWorkerPool()", () => {
  it("uses the executor when processNext() is called", async () => {
    const ran: string[] = [];
    const executor = {
      async run(record: { className: string }) {
        ran.push(record.className);
        return { success: true as const };
      },
    };

    const driver = new SyncDriver();
    const manager = new QueueManager(driver);
    manager.setWorkerPool(executor);

    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: JSON.stringify({ name: "X" }),
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });

    await manager.processNext();
    expect(ran).toContain("GreetJob");
  });

  it("size() and flush() do not throw", async () => {
    const manager = new QueueManager(new SyncDriver());
    await expect(manager.size()).resolves.toBe(0);
    await expect(manager.flush()).resolves.toBeUndefined();
  });
});

// ── Batch — uncovered getters (lines 28-31) ───────────────────────────────────

describe("Batch — all getters", () => {
  const rec = {
    id: "b-123",
    name: "test-batch",
    totalJobs: 4,
    pendingJobs: 1,
    failedJobs: 2,
    failedJobIds: [10, 20],
    options: { thenJobs: undefined, catchJobs: undefined, finallyJobs: undefined },
    createdAt: "2024-06-01T00:00:00Z",
    finishedAt: undefined as string | undefined,
  };

  it("failedJobIds returns the IDs array", () => {
    expect(new Batch(rec).failedJobIds).toEqual([10, 20]);
  });

  it("options returns batch options object", () => {
    expect(new Batch(rec).options).toBe(rec.options);
  });

  it("createdAt returns the creation timestamp", () => {
    expect(new Batch(rec).createdAt).toBe("2024-06-01T00:00:00Z");
  });

  it("finishedAt returns undefined when not finished", () => {
    expect(new Batch(rec).finishedAt).toBeUndefined();
  });

  it("finishedAt returns the string when batch is finished", () => {
    const ts = "2024-06-01T02:00:00Z";
    expect(new Batch({ ...rec, finishedAt: ts }).finishedAt).toBe(ts);
  });

  it("progress() with zero totalJobs returns 1 (empty-batch edge case)", () => {
    expect(new Batch({ ...rec, totalJobs: 0, pendingJobs: 0 }).progress()).toBe(1);
  });
});

// ── Job — base class payload() (covers uncovered function) ────────────────────

describe("Job — base payload()", () => {
  it("default payload() returns an empty object", () => {
    class MinimalJob extends Job {
      async handle(): Promise<void> {}
    }
    expect(new MinimalJob().payload()).toEqual({});
  });
});

// ── JobRegistry — all() method ────────────────────────────────────────────────

describe("JobRegistry.all()", () => {
  it("returns the full registry map", () => {
    JobRegistry.register(GreetJob as never);
    const map = JobRegistry.all();
    expect(map.has("GreetJob")).toBe(true);
    expect(map.get("GreetJob")).toBe(GreetJob);
  });
});

// ── QueueFake — install() and restore() (mock Application) ──────────────────

describe("QueueFake.install() / restore()", () => {
  // Run the test with a minimal mock as the current application (via withApp),
  // avoiding a real Application which registers global error handlers in the process.
  function withMockApp(
    setup: (registry: Map<string, unknown>) => void,
    test: (registry: Map<string, unknown>) => void,
  ) {
    const registry = new Map<string, unknown>();
    setup(registry);
    const mockApp = {
      container: {
        registry,
        value: (key: string, val: unknown) => registry.set(key, val),
      },
    };
    withApp(mockApp as never, () => test(registry));
  }

  it("install() captures original and binds the fake to the registry", () => {
    withMockApp(
      (r) => r.set("queue", { sentinel: true }),
      (r) => {
        const fake = QueueFake.install();
        expect(fake).toBeInstanceOf(QueueFake);
        expect(r.get("queue")).toBe(fake);
      },
    );
  });

  it("restore() reinstates the original binding", () => {
    const original = { sentinel: true };
    withMockApp(
      (r) => r.set("queue", original),
      (r) => {
        const fake = QueueFake.install();
        fake.restore();
        expect(r.get("queue")).toBe(original);
      },
    );
  });

  it("restore() deletes the binding when there was no original", () => {
    withMockApp(
      (_r) => {
        /* no queue binding */
      },
      (r) => {
        const fake = QueueFake.install();
        fake.restore();
        expect(r.has("queue")).toBe(false);
      },
    );
  });
});

// ── QueueManager — executor fail/retry paths + non-executor processNext ────────

describe("QueueManager.processNext() — uncovered paths", () => {
  beforeEach(() => {
    JobRegistry.register(GreetJob as never);
    GreetJob.calls = [];
  });

  it("without executor falls back to _processRecord (covers line 153)", async () => {
    const db = new SQL(":memory:") as unknown as SQLInstance;
    const manager = new QueueManager(new SqliteDriver(db));

    await (manager as unknown as { _driver: SqliteDriver })._driver.push({
      queue: "default",
      className: "GreetJob",
      payload: JSON.stringify({ name: "NE" }),
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });

    expect(await manager.processNext()).toBe(true);
    expect(GreetJob.calls).toContain("NE");
  });

  it("executor {success:false} + attempts >= maxAttempts → permanently fails", async () => {
    const db = new SQL(":memory:") as unknown as SQLInstance;
    const driver = new SqliteDriver(db);
    const manager = new QueueManager(driver);
    manager.setWorkerPool({
      async run() {
        return { success: false as const, error: "perm" };
      },
    });

    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 3,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });

    expect(await manager.processNext()).toBe(true);
    expect(await driver.size("default")).toBe(0);
  });

  it("executor {success:false} + attempts < maxAttempts → retries job", async () => {
    const db = new SQL(":memory:") as unknown as SQLInstance;
    const driver = new SqliteDriver(db);
    const manager = new QueueManager(driver);
    manager.setWorkerPool({
      async run() {
        return { success: false as const, error: "tmp" };
      },
    });

    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 1,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });

    expect(await manager.processNext()).toBe(true);
  });
});

// ── QueueManager — isShuttingDown / activeJobCount getters + drain() Promise ──

describe("QueueManager — getters and drain() Promise path", () => {
  it("isShuttingDown getter returns false before drain() (covers line 158)", () => {
    const manager = new QueueManager(new SyncDriver());
    expect(manager.isShuttingDown).toBe(false);
  });

  it("activeJobCount getter returns 0 initially", () => {
    const manager = new QueueManager(new SyncDriver());
    expect((manager as unknown as { activeJobCount: number }).activeJobCount).toBe(0);
  });

  it("drain() creates a deferred Promise when jobs are active (lines 164-165)", async () => {
    const manager = new QueueManager(new SyncDriver());
    // Simulate an in-flight job by bumping the private counter
    (manager as unknown as { _activeJobCount: number })._activeJobCount = 1;

    const drainPromise = manager.drain();
    expect(manager.isShuttingDown).toBe(true);

    // Simulate the job completing and calling _drainResolve
    (manager as unknown as { _activeJobCount: number })._activeJobCount = 0;
    (manager as unknown as { _drainResolve?: () => void })._drainResolve?.();

    await drainPromise;
  });
});

// ── QueueConfig factory ───────────────────────────────────────────────────────

describe("QueueConfig factory", () => {
  it("returns defaults when called with no args", () => {
    const cfg = QueueConfig();
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.pollInterval).toBe(500);
    expect(cfg.queues).toEqual(["default"]);
    expect(cfg.workers).toBe(0);
  });

  it("overrides driver", () => {
    const cfg = QueueConfig({ driver: "redis" });
    expect(cfg.driver).toBe("redis");
  });

  it("overrides pollInterval", () => {
    const cfg = QueueConfig({ pollInterval: 1000 });
    expect(cfg.pollInterval).toBe(1000);
  });

  it("overrides queues array", () => {
    const cfg = QueueConfig({ queues: ["default", "emails", "notifications"] });
    expect(cfg.queues).toEqual(["default", "emails", "notifications"]);
  });

  it("overrides workers count", () => {
    const cfg = QueueConfig({ workers: 4, workerBootstrap: "file:///bootstrap/worker.ts" });
    expect(cfg.workers).toBe(4);
    expect(cfg.workerBootstrap).toBe("file:///bootstrap/worker.ts");
  });

  it("keeps default queues when not overridden", () => {
    const cfg = QueueConfig({ driver: "sync" });
    expect(cfg.queues).toEqual(["default"]);
  });
});

// ── QueueProvider — register() binds the queue singleton ─────────────────────

describe("QueueProvider — onRegister()", () => {
  function makeApp(driverName: string) {
    const registry = new Map<string, unknown>();
    const singletonFns = new Map<string, () => unknown>();
    const configManager = {
      get: (key: string, fallback: unknown) => {
        if (key === "queue.driver") return driverName;
        return fallback;
      },
    };
    const container = {
      registry,
      singleton(key: string, fn: () => unknown) {
        singletonFns.set(key, fn);
        registry.set(key, fn); // store factory
      },
      makeSync(key: string) {
        if (key === "config") return configManager;
        const factory = singletonFns.get(key);
        if (factory) {
          const inst = factory();
          registry.set(key, inst);
          return inst;
        }
        return registry.get(key);
      },
      async make(key: string) {
        return this.makeSync(key);
      },
      tryMake(key: string) {
        return this.makeSync(key);
      },
    };
    const app = {
      container,
      _env: "test",
    };
    return { app, singletonFns, configManager };
  }

  it('onRegister() sets up a "queue" singleton factory', async () => {
    const { app, singletonFns } = makeApp("sync");
    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const provider = new (QueueProvider as unknown as new (app: unknown) => { onRegister(): void })(
      app,
    );
    provider.onRegister();
    expect(singletonFns.has("queue")).toBe(true);
  });

  it("singleton factory returns a QueueManager with SyncDriver", async () => {
    const { app } = makeApp("sync");
    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const { QueueManager } = await import("./QueueManager.ts");
    const provider = new (QueueProvider as unknown as new (app: unknown) => { onRegister(): void })(
      app,
    );
    provider.onRegister();
    const queue = app.container.makeSync("queue");
    expect(queue).toBeInstanceOf(QueueManager);
  });

  it("onBooting() sets up Bus with the QueueManager", async () => {
    const { app } = makeApp("sync");
    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const { Bus } = await import("./Bus.ts");
    const provider = new (
      QueueProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooting(): Promise<void>;
      }
    )(app);
    provider.onRegister();
    await provider.onBooting();
    // Bus.setManager should have been called — verify Bus has a manager
    // (Bus.manager is the internal field)
    const mgr = (Bus as unknown as Record<string, unknown>)._manager;
    expect(mgr).toBeDefined();
  });

  it("onBooted() registers commands when a command runner is present", async () => {
    const { app } = makeApp("sync");
    const registeredLazy: string[] = [];
    (app as unknown as Record<string, unknown>).container = {
      ...(app as unknown as Record<string, { container: unknown }>).container,
      tryMake(key: string) {
        if (key === "commands")
          return {
            registerLazy(name: string) {
              registeredLazy.push(name);
            },
          };
        return (
          app as unknown as { container: { makeSync: (k: string) => unknown } }
        ).container.makeSync(key);
      },
      singleton(key: string, fn: () => unknown) {
        (this as unknown as Record<string, unknown>)["_factory_" + key] = fn;
      },
      makeSync(key: string) {
        if (key === "config") return { get: (_: string, fb: unknown) => fb };
        const factory = (this as unknown as Record<string, () => unknown>)["_factory_" + key];
        return factory ? factory() : undefined;
      },
      async make(key: string) {
        return this.makeSync(key);
      },
    };

    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const provider = new (
      QueueProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooted(): Promise<void>;
      }
    )(app);
    provider.onRegister();
    await provider.onBooted();
    expect(registeredLazy).toContain("queue:work");
    expect(registeredLazy).toContain("queue:failed");
    expect(registeredLazy).toContain("queue:retry");
    expect(registeredLazy).toContain("queue:flush");
  });

  it("onBooted() is a no-op when no command runner is registered", async () => {
    const { app } = makeApp("sync");
    // Override tryMake to return null for 'commands'
    const origMakeSync = app.container.makeSync.bind(app.container);
    (app.container as unknown as Record<string, unknown>).tryMake = (key: string) => {
      if (key === "commands") return null;
      return origMakeSync(key);
    };
    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const provider = new (
      QueueProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooted(): Promise<void>;
      }
    )(app);
    provider.onRegister();
    // Should not throw
    await expect(provider.onBooted()).resolves.toBeUndefined();
  });

  it("onStopping() drains the queue when one is registered", async () => {
    const { app } = makeApp("sync");
    let drainCalled = false;
    const fakeQueue = {
      drain: async () => {
        drainCalled = true;
      },
      isShuttingDown: false,
    };
    // Override tryMake to return the fake queue
    (app.container as unknown as Record<string, unknown>).tryMake = (key: string) => {
      if (key === "queue") return fakeQueue;
      return null;
    };
    const { QueueProvider } = await import("./provider/QueueProvider.ts");
    const provider = new (
      QueueProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onStopping(): Promise<void>;
      }
    )(app);
    provider.onRegister();
    await provider.onStopping();
    expect(drainCalled).toBe(true);
  });
});

// ── Bus — implicit constructor coverage ─────────────────────────────────────

describe("Bus constructor", () => {
  it("Bus can be instantiated (covers implicit constructor)", () => {
    expect(new BusClass()).toBeDefined();
  });
});

// ── WorkerPool ────────────────────────────────────────────────────────────────

import { WorkerPool } from "./WorkerPool.ts";

describe("WorkerPool — terminate before start", () => {
  it("terminate() with empty pool resolves immediately", async () => {
    const pool = new WorkerPool({ size: 2, bootstrapPath: "/fake/bootstrap.ts" });
    await expect(pool.terminate()).resolves.toBeUndefined();
  });

  it("run() queues job and terminate() resolves it with terminated error", async () => {
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    // No workers started — run() parks the job in _pending
    const resultP = pool.run({
      id: 1,
      queue: "default",
      className: "FakeJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });
    // Terminate before workers exist — resolves pending as failed
    await pool.terminate();
    const result = await resultP;
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("terminated");
  });
});

describe("WorkerPool — with mock workers", () => {
  let origWorker: typeof globalThis.Worker;

  beforeEach(() => {
    origWorker = (globalThis as any).Worker;
  });
  afterEach(() => {
    (globalThis as any).Worker = origWorker;
  });

  function makeMockWorker(): {
    worker: EventTarget & { postMessage: (m: unknown) => void; terminate: () => void };
    sent: unknown[];
  } {
    const sent: unknown[] = [];
    const worker = Object.assign(new EventTarget(), {
      postMessage(msg: unknown) {
        sent.push(msg);
        const m = msg as { type: string };
        if (m.type === "bootstrap") {
          // Simulate successful bootstrap
          queueMicrotask(() => {
            worker.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
          });
        }
      },
      terminate() {},
    });
    return { worker, sent };
  }

  it("start() spawns workers and waits for ready", async () => {
    const mocks: ReturnType<typeof makeMockWorker>[] = [];

    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        const m = makeMockWorker();
        mocks.push(m);
        // Copy event listener methods from the mock worker
        Object.assign(this, m.worker);
        // Override postMessage on this instance
        (this as any).postMessage = m.worker.postMessage.bind(m.worker);
        (this as any).terminate = m.worker.terminate.bind(m.worker);
        // Delegate addEventListener/removeEventListener
        (this as any).addEventListener = m.worker.addEventListener.bind(m.worker);
        (this as any).removeEventListener = m.worker.removeEventListener.bind(m.worker);
        (this as any).dispatchEvent = m.worker.dispatchEvent.bind(m.worker);
      }
    };

    const pool = new WorkerPool({ size: 2, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    expect(mocks).toHaveLength(2);
    expect(mocks[0]!.sent.some((m: any) => m.type === "bootstrap")).toBe(true);

    await pool.terminate();
  });

  it("start() rejects when a worker sends bootstrap-error", async () => {
    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        const et = new EventTarget();
        (this as any).addEventListener = et.addEventListener.bind(et);
        (this as any).removeEventListener = et.removeEventListener.bind(et);
        (this as any).dispatchEvent = et.dispatchEvent.bind(et);
        (this as any).terminate = () => {};
        (this as any).postMessage = (msg: unknown) => {
          if ((msg as any).type === "bootstrap") {
            queueMicrotask(() => {
              et.dispatchEvent(
                new MessageEvent("message", {
                  data: { type: "bootstrap-error", message: "module not found" },
                }),
              );
            });
          }
        };
      }
    };

    const pool = new WorkerPool({ size: 1, bootstrapPath: "/bad/path.ts" });
    await expect(pool.start()).rejects.toThrow("bootstrap failed");
  });

  it("run() dispatches job to free worker and resolves done", async () => {
    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        const et = new EventTarget();
        (this as any).addEventListener = et.addEventListener.bind(et);
        (this as any).removeEventListener = et.removeEventListener.bind(et);
        (this as any).dispatchEvent = et.dispatchEvent.bind(et);
        (this as any).terminate = () => {};
        (this as any).postMessage = (msg: unknown) => {
          const m = msg as { type: string };
          if (m.type === "bootstrap") {
            queueMicrotask(() => {
              et.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
            });
          } else if (m.type === "job") {
            // Simulate successful job completion
            queueMicrotask(() => {
              et.dispatchEvent(new MessageEvent("message", { data: { type: "done" } }));
            });
          }
        };
      }
    };

    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    const result = await pool.run({
      id: 2,
      queue: "default",
      className: "TestJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });

    expect(result).toEqual({ success: true });
    await pool.terminate();
  });

  it("run() resolves with error result when worker sends error message", async () => {
    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        const et = new EventTarget();
        (this as any).addEventListener = et.addEventListener.bind(et);
        (this as any).removeEventListener = et.removeEventListener.bind(et);
        (this as any).dispatchEvent = et.dispatchEvent.bind(et);
        (this as any).terminate = () => {};
        (this as any).postMessage = (msg: unknown) => {
          const m = msg as { type: string };
          if (m.type === "bootstrap") {
            queueMicrotask(() => {
              et.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
            });
          } else if (m.type === "job") {
            queueMicrotask(() => {
              et.dispatchEvent(
                new MessageEvent("message", { data: { type: "error", message: "job blew up" } }),
              );
            });
          }
        };
      }
    };

    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    const result = await pool.run({
      id: 3,
      queue: "default",
      className: "BadJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("job blew up");
    await pool.terminate();
  });

  it("terminate() resolves in-flight job with terminated error", async () => {
    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        const et = new EventTarget();
        (this as any).addEventListener = et.addEventListener.bind(et);
        (this as any).removeEventListener = et.removeEventListener.bind(et);
        (this as any).dispatchEvent = et.dispatchEvent.bind(et);
        (this as any).terminate = () => {};
        (this as any).postMessage = (msg: unknown) => {
          const m = msg as { type: string };
          if (m.type === "bootstrap") {
            queueMicrotask(() => {
              et.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
            });
          }
          // job message: never responds — simulates in-flight job
        };
      }
    };

    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    const resultP = pool.run({
      id: 4,
      queue: "default",
      className: "SlowJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });

    // Give time for the job to be dispatched to the worker (drainPending runs synchronously)
    await new Promise((r) => setTimeout(r, 10));

    // Terminate while job is in-flight
    await pool.terminate();
    const result = await resultP;
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("terminated");
  });
});

// ── WorkerPool — a worker that dies ───────────────────────────────────────────

describe("WorkerPool — a dead worker does not wedge the pool", () => {
  let origWorker: typeof globalThis.Worker;
  beforeEach(() => {
    origWorker = (globalThis as any).Worker;
  });
  afterEach(() => {
    (globalThis as any).Worker = origWorker;
  });

  /** A mock worker that bootstraps, then dies the first time it is handed a job. */
  function installDyingWorker(kill: (et: EventTarget) => void): { spawns: number } {
    const counter = { spawns: 0 };
    (globalThis as any).Worker = class {
      constructor(_url: URL) {
        counter.spawns++;
        const et = new EventTarget();
        const isFirst = counter.spawns === 1;
        (this as any).addEventListener = et.addEventListener.bind(et);
        (this as any).removeEventListener = et.removeEventListener.bind(et);
        (this as any).dispatchEvent = et.dispatchEvent.bind(et);
        (this as any).terminate = () => {};
        (this as any).postMessage = (msg: unknown) => {
          const m = msg as { type: string };
          if (m.type === "bootstrap") {
            queueMicrotask(() =>
              et.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } })),
            );
          } else if (m.type === "job") {
            // Only the original worker dies; its replacement completes the work.
            if (isFirst) queueMicrotask(() => kill(et));
            else
              queueMicrotask(() =>
                et.dispatchEvent(new MessageEvent("message", { data: { type: "done" } })),
              );
          }
        };
      }
    };
    return counter;
  }

  const record = (id: number) => ({
    id,
    queue: "default",
    className: "FakeJob",
    payload: "{}",
    attempts: 0,
    maxAttempts: 3,
    retryDelay: 0,
    availableAt: Math.floor(Date.now() / 1000),
  });

  it("settles the in-flight promise when the worker exits mid-job", async () => {
    // Without a close listener this promise never settled: the caller hung forever and the
    // slot stayed busy, so a size:1 pool was wedged for good.
    installDyingWorker((et) => et.dispatchEvent(new Event("close")));
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    const result = await pool.run(record(1) as never);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("exited");

    await pool.terminate();
  });

  it("settles the in-flight promise when the worker errors", async () => {
    installDyingWorker((et) => et.dispatchEvent(new ErrorEvent("error", { message: "segfault" })));
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();

    const result = await pool.run(record(1) as never);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("segfault");

    await pool.terminate();
  });

  it("respawns the slot, so the pool keeps working afterwards", async () => {
    const counter = installDyingWorker((et) => et.dispatchEvent(new Event("close")));
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();
    expect(counter.spawns).toBe(1);

    await pool.run(record(1) as never); // kills the worker
    await new Promise((r) => setTimeout(r, 10)); // let the respawn land
    expect(counter.spawns).toBe(2);

    // The pool is still usable — the whole point of replacing the slot.
    const second = await pool.run(record(2) as never);
    expect(second.success).toBe(true);

    await pool.terminate();
  });

  it("does not respawn after terminate()", async () => {
    const counter = installDyingWorker((et) => et.dispatchEvent(new Event("close")));
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts" });
    await pool.start();
    await pool.terminate();

    const spawnsAtTerminate = counter.spawns;
    await new Promise((r) => setTimeout(r, 10));
    expect(counter.spawns).toBe(spawnsAtTerminate);
  });
});

describe("WorkerPool — the backlog is bounded", () => {
  it("fails a job rather than queueing it past the cap", async () => {
    // A waiting job is already claimed from the driver and counting down its visibility
    // timeout. An unbounded backlog meant it aged out and was reclaimed and executed a
    // second time while the first copy was still sitting here.
    const pool = new WorkerPool({ size: 1, bootstrapPath: "/fake/bootstrap.ts", maxPending: 2 });
    const record = (id: number) => ({
      id,
      queue: "default",
      className: "FakeJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
    });

    // No workers started, so nothing drains: the first two park, the third is refused.
    const first = pool.run(record(1) as never);
    const second = pool.run(record(2) as never);
    const third = await pool.run(record(3) as never);

    expect(third.success).toBe(false);
    expect((third as { success: false; error: string }).error).toContain("backlog is full");

    await pool.terminate();
    await Promise.all([first, second]);
  });
});
