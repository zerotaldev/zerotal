import { describe, it, expect, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Application } from "@zerotal/core";
import { Job } from "./Job.ts";
import { JobRegistry } from "./JobRegistry.ts";
import { QueueManager } from "./QueueManager.ts";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { Bus } from "./Bus.ts";
import { QueueError } from "./errors.ts";

/**
 * A job queued from a stored name runs under its own class's policy.
 *
 * Three paths queue a job from a class name and a payload rather than from an instance, and each
 * made the numbers up: `retryFailed()` (the admin and monitor retry buttons) used three attempts
 * and no delay, the next link of a chain inherited the previous job's queue and policy, and a
 * batch's `then`/`catch`/`finally` jobs went to `default` with three attempts and one second. A
 * job that declared one attempt, or a minute between attempts, or its own queue, did not get it.
 */

class ChargeCard extends Job {
  override readonly queue = "billing";
  override readonly maxAttempts = 1;
  override readonly retryDelay = 60_000;
  async handle() {
    throw new Error("card declined");
  }
}

class First extends Job {
  override readonly maxAttempts = 1;
  override readonly retryDelay = 0;
  async handle() {}
}

class SendReceipt extends Job {
  override readonly queue = "mail";
  override readonly maxAttempts = 7;
  override readonly retryDelay = 5_000;
  constructor(readonly orderId = 0) {
    super();
  }
  override payload() {
    return { orderId: this.orderId };
  }
  static fromPayload(p: Record<string, unknown>) {
    return new SendReceipt(p["orderId"] as number);
  }
  async handle() {}
}

class Unregistered extends Job {
  async handle() {}
}

/** Registered, but its payload cannot be turned back into a job. */
class Unbuildable extends Job {
  static fromPayload(): Unbuildable {
    throw new Error("order 9 no longer exists");
  }
  async handle() {}
}

JobRegistry.register(ChargeCard);
JobRegistry.register(First);
JobRegistry.register(SendReceipt);
JobRegistry.register(Unbuildable);

let manager: QueueManager;

beforeEach(() => {
  manager = new QueueManager(new SqliteDriver(new SQL(":memory:") as unknown as SQLInstance));
  Bus.reset();
  Bus.setManager(manager);
});

/** The one pending row, policy fields only. */
async function onlyPending() {
  const rows = await manager.pending();
  expect(rows).toHaveLength(1);
  const { queue, className, maxAttempts, retryDelay, attempts } = rows[0]!;
  return { queue, className, maxAttempts, retryDelay, attempts };
}

describe("retryFailed()", () => {
  it("queues the job with its own maxAttempts and retryDelay, on its queue", async () => {
    await manager.dispatch(new ChargeCard());
    await manager.processNext("billing");
    const [failed] = await manager.failed();

    expect(await manager.retryFailed(failed!.id)).toBe(true);
    expect(await onlyPending()).toEqual({
      queue: "billing",
      className: "ChargeCard",
      maxAttempts: 1,
      retryDelay: 60_000,
      attempts: 0,
    });
    expect(await manager.failed()).toHaveLength(0);
  });

  it("refuses a class it cannot resolve and keeps the failed row", async () => {
    await manager.dispatch(new Unregistered());
    await manager.processNext("default");
    const [failed] = await manager.failed();
    expect(failed!.className).toBe("Unregistered");

    await expect(manager.retryFailed(failed!.id)).rejects.toBeInstanceOf(QueueError);
    expect(await manager.pending()).toHaveLength(0);
    expect(await manager.failed()).toHaveLength(1);
  });
});

describe("a chain", () => {
  it("queues the next job under the next job's policy, not the previous one's", async () => {
    await Bus.chain([new First(), new SendReceipt(42)]).dispatch();
    await manager.processNext("default");

    expect(await onlyPending()).toEqual({
      queue: "mail",
      className: "SendReceipt",
      maxAttempts: 7,
      retryDelay: 5_000,
      attempts: 0,
    });
  });

  // A class this worker does not know has no policy to read, but dropping the job would lose it
  // without a trace. It is queued as before, so the worker fails it where it can be retried.
  it("queues a next job whose class it cannot resolve, and the worker fails it visibly", async () => {
    await Bus.chain([new First(), new Unregistered()]).dispatch();
    await manager.processNext("default");
    expect(await onlyPending()).toEqual({
      queue: "default",
      className: "Unregistered",
      maxAttempts: 1,
      retryDelay: 0,
      attempts: 0,
    });
    expect(await manager.failed()).toHaveLength(0);

    await manager.processNext("default");
    const failed = await manager.failed();
    expect(failed.map((f) => [f.className, f.error])).toEqual([
      ["Unregistered", "Unknown job class: Unregistered"],
    ]);
  });

  // Rebuilding the next job runs its fromPayload() while the previous job is completing. An
  // error there must not be taken for the previous job failing: that job already succeeded.
  it("queues a next job that cannot be rebuilt, and the finished job stays finished", async () => {
    await Bus.chain([new First(), new Unbuildable()]).dispatch();
    await manager.processNext("default");
    expect(await manager.failed()).toHaveLength(0);
    expect((await onlyPending()).className).toBe("Unbuildable");

    await manager.processNext("default");
    const failed = await manager.failed();
    expect(failed.map((f) => [f.className, f.error])).toEqual([
      ["Unbuildable", "order 9 no longer exists"],
    ]);
  });
});

describe("a batch's callbacks", () => {
  it("queue each then/finally job under its own policy", async () => {
    await Bus.batch([new First()]).then(new SendReceipt(1)).finally(new SendReceipt(2)).dispatch();
    await manager.processNext("default");

    const rows = await manager.pending();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect({
        queue: row.queue,
        maxAttempts: row.maxAttempts,
        retryDelay: row.retryDelay,
      }).toEqual({ queue: "mail", maxAttempts: 7, retryDelay: 5_000 });
    }
  });

  it("queue a callback that cannot be rebuilt as before, next to the others", async () => {
    await Bus.batch([new First()]).then(new Unbuildable()).finally(new SendReceipt(4)).dispatch();
    await manager.processNext("default");

    expect(await manager.failed()).toHaveLength(0);
    const rows = (await manager.pending()).map((r) => [r.className, r.queue, r.maxAttempts]);
    expect(rows).toContainEqual(["Unbuildable", "default", 3]);
    expect(rows).toContainEqual(["SendReceipt", "mail", 7]);
  });

  it("queue a callback whose class is unknown, and the worker fails it visibly", async () => {
    await Bus.batch([new First()]).then(new Unregistered()).dispatch();
    await manager.processNext("default");
    expect(await onlyPending()).toEqual({
      queue: "default",
      className: "Unregistered",
      maxAttempts: 3,
      retryDelay: 1000,
      attempts: 0,
    });

    await manager.processNext("default");
    const failed = await manager.failed();
    expect(failed.map((f) => [f.className, f.error])).toEqual([
      ["Unregistered", "Unknown job class: Unregistered"],
    ]);
  });

  // Queued without its own policy, the job is named in a warning, so the push under the fallback
  // numbers is not silent until the worker fails it.
  it("warn when a callback or chain link is queued without its own policy", async () => {
    Application._resetInstance(); // no ambient app, so frameworkLog() writes to stdout
    let out = "";
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    try {
      await Bus.batch([new First()]).then(new Unregistered()).dispatch();
      await Bus.chain([new First(), new Unbuildable()]).dispatch();
      await manager.processNext("default");
      await manager.processNext("default");
    } finally {
      process.stdout.write = write;
    }

    const warnings = out.split("\n").filter((line) => line.includes("WARN"));
    expect(warnings.join("\n")).toContain(
      'Queued a batch callback job on "default" without its own policy: "Unregistered" is not a registered job class',
    );
    expect(warnings.join("\n")).toContain(
      `Queued the next job in First's chain on "default" without its own policy: "Unbuildable" could not be rebuilt from its payload (order 9 no longer exists)`,
    );
  });

  it("queue a catch job under its own policy", async () => {
    await Bus.batch([new ChargeCard()]).catch(new SendReceipt(3)).dispatch();
    await manager.processNext("billing");

    expect(await onlyPending()).toEqual({
      queue: "mail",
      className: "SendReceipt",
      maxAttempts: 7,
      retryDelay: 5_000,
      attempts: 0,
    });
  });
});
