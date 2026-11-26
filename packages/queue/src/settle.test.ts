/**
 * `settle()` — "let the background work finish" in one call, on the fake and on a
 * real manager, so a test never writes its own loop around `processNext()`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { SQL } from "bun";
import { Application, currentApp } from "@zerotal/core";
import type { SQLInstance } from "@zerotal/orm";
import { Job } from "./Job.ts";
import { JobRegistry } from "./JobRegistry.ts";
import { QueueFake } from "./QueueFake.ts";
import { QueueManager } from "./QueueManager.ts";
import { QueueError } from "./errors.ts";
import { Queue } from "./facades/Queue.ts";
import { Bus } from "./Bus.ts";
import { DatabaseDriver } from "./drivers/DatabaseDriver.ts";
import { SyncDriver } from "./drivers/SyncDriver.ts";

const log: string[] = [];

class StepJob extends Job {
  constructor(public readonly name: string = "") {
    super();
  }
  override payload(): Record<string, unknown> {
    return { name: this.name };
  }
  static fromPayload(p: Record<string, unknown>): StepJob {
    return new StepJob(String(p["name"]));
  }
  async handle(): Promise<void> {
    log.push(this.name);
  }
}

/** Dispatches a follow-up from inside `handle()`, the way real jobs fan out. */
class FanOutJob extends Job {
  override readonly queue = "imports";
  constructor(public readonly rows: number = 0) {
    super();
  }
  override payload(): Record<string, unknown> {
    return { rows: this.rows };
  }
  static fromPayload(p: Record<string, unknown>): FanOutJob {
    return new FanOutJob(Number(p["rows"]));
  }
  async handle(): Promise<void> {
    log.push(`import:${this.rows}`);
    for (let i = 0; i < this.rows; i++) await Queue.dispatch(new StepJob(`row${i}`));
  }
}

class ExplodingJob extends Job {
  override readonly maxAttempts = 1;
  async handle(): Promise<void> {
    throw new Error("card declined");
  }
}

class ForeverJob extends Job {
  async handle(): Promise<void> {
    await Queue.dispatch(new ForeverJob());
  }
}

JobRegistry.register(StepJob as never);
JobRegistry.register(FanOutJob as never);
JobRegistry.register(ExplodingJob as never);
JobRegistry.register(ForeverJob as never);

let app: Application;
let created = false;

beforeAll(() => {
  try {
    app = Application.create({ env: "test" });
    created = true;
  } catch {
    app = currentApp();
  }
  app.container.value("queue", {});
});

// Leave no application behind: later files in the same process create their own.
afterAll(() => {
  if (created) Application._resetInstance();
});

afterEach(() => {
  log.length = 0;
});

describe("QueueFake.settle()", () => {
  let queue: QueueFake;
  afterEach(() => queue?.restore());

  it("runs every captured job, in dispatch order, and says how many", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new StepJob("a"));
    await Queue.dispatch(new StepJob("b"));
    expect(log).toEqual([]); // captured, not run

    expect(await Queue.settle()).toBe(2);
    expect(log).toEqual(["a", "b"]);
  });

  it("runs what those jobs dispatch in the same call, and keeps every job assertable", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new FanOutJob(2));

    expect(await queue.settle()).toBe(3);
    expect(log).toEqual(["import:2", "row0", "row1"]);
    queue.assertDispatched(StepJob, (j) => j.name === "row1");
    queue.assertDispatchedCount(3);
  });

  it("does not run a job twice when settled again, but does run a new one", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new StepJob("a"));
    await queue.settle();
    await Queue.dispatch(new StepJob("b"));

    expect(await queue.settle()).toBe(1);
    expect(log).toEqual(["a", "b"]);
    expect(await queue.settle()).toBe(0);
  });

  it("runs the same instance twice when it was dispatched twice", async () => {
    queue = QueueFake.install();
    const job = new StepJob("again");
    await Queue.dispatch(job);
    await Queue.dispatch(job);
    expect(await queue.settle()).toBe(2);
  });

  it("dispatches a chain's next link when a link succeeds", async () => {
    queue = QueueFake.install();
    const first = new StepJob("one");
    first._chain = [
      { className: "StepJob", payload: { name: "two" } },
      { className: "StepJob", payload: { name: "three" } },
    ];
    await Queue.dispatch(first);

    await queue.settle();
    expect(log).toEqual(["one", "two", "three"]);
  });

  it("runs the rest when one fails, then throws naming the failure", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new ExplodingJob());
    await Queue.dispatch(new StepJob("after"));

    const error = await queue.settle().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueError);
    expect((error as QueueError).code).toBe("E_QUEUE_SETTLE_FAILED");
    expect((error as Error).message).toContain("ExplodingJob: card declined");
    expect(((error as Error).cause as Error).message).toBe("card declined");
    expect(log).toEqual(["after"]);
  });

  it("stops a job that keeps dispatching itself instead of hanging the test", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new ForeverJob());
    const error = await queue.settle({ limit: 25 }).catch((e: unknown) => e);
    expect((error as QueueError).code).toBe("E_QUEUE_SETTLE_LIMIT");
  });

  it("starts over after flush()", async () => {
    queue = QueueFake.install();
    await Queue.dispatch(new StepJob("a"));
    await queue.settle();
    await queue.flush();
    await Queue.dispatch(new StepJob("b"));
    expect(await queue.settle()).toBe(1);
    expect(log).toEqual(["a", "b"]);
  });
});

describe("QueueManager.settle()", () => {
  let original: unknown;
  beforeAll(() => {
    original = app.container.registry.get("queue");
  });
  afterEach(() => {
    app.container.registry.set("queue", original as never);
    Bus.reset();
  });

  function bind(manager: QueueManager): QueueManager {
    app.container.value("queue", manager);
    return manager;
  }

  it("drains every queue, including work the jobs dispatch onto other queues", async () => {
    const manager = bind(new QueueManager(new DatabaseDriver(new SQL(":memory:") as never)));
    await manager.dispatch(new FanOutJob(2)); // on "imports"; its rows go to "default"

    expect(await Queue.settle()).toBe(3);
    expect(log).toEqual(["import:2", "row0", "row1"]);
    expect(await manager.size("imports")).toBe(0);
    expect(await manager.size("default")).toBe(0);
  });

  it("does not throw for a failing job — it fails it, as a worker would", async () => {
    const driver = new DatabaseDriver(new SQL(":memory:") as unknown as SQLInstance);
    const manager = bind(new QueueManager(driver));
    await manager.dispatch(new ExplodingJob());

    expect(await manager.settle()).toBe(1);
    expect((await manager.failed()).map((f) => f.error)).toEqual(["card declined"]);
  });

  it("leaves a job that is not yet due", async () => {
    const manager = bind(new QueueManager(new DatabaseDriver(new SQL(":memory:") as never)));
    class LaterJob extends StepJob {
      override readonly debounce = 60;
    }
    JobRegistry.register(LaterJob as never);
    await manager.dispatch(new LaterJob("later"));

    expect(await manager.settle()).toBe(0);
    expect(await manager.size()).toBe(1);
  });

  it("drains only the queues it is given", async () => {
    const manager = bind(new QueueManager(new DatabaseDriver(new SQL(":memory:") as never)));
    await manager.dispatch(new FanOutJob(1));
    expect(await manager.settle({ queues: ["default"] })).toBe(0);
    expect(await manager.settle({ queues: ["imports", "default"] })).toBe(2);
  });

  it("stops a job that keeps dispatching itself", async () => {
    const manager = bind(new QueueManager(new DatabaseDriver(new SQL(":memory:") as never)));
    await manager.dispatch(new ForeverJob());
    const error = await manager.settle({ limit: 10 }).catch((e: unknown) => e);
    expect((error as QueueError).code).toBe("E_QUEUE_SETTLE_LIMIT");
  });

  it("is a no-op on the sync driver, where every job already ran on dispatch", async () => {
    const manager = bind(new QueueManager(new SyncDriver()));
    await manager.dispatch(new StepJob("inline"));
    expect(log).toEqual(["inline"]);
    expect(await manager.settle()).toBe(0);
  });
});
