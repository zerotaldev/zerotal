/**
 * `zt doctor`'s queue-worker check says what is there.
 *
 * It used to say "nothing registered, nothing to run" whenever the `default` queue
 * was empty. Job classes register themselves when a worker imports `app/jobs/`, so
 * the web process running the doctor never counted them, and an app with several
 * jobs was told it had none. Jobs waiting on any other queue were not counted
 * either, so `emails` could fill up with no worker and the check stayed quiet.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@zerotal/core";
import type { SQLInstance } from "@zerotal/orm";
import { DatabaseDriver } from "./drivers/DatabaseDriver.ts";
import { QueueManager } from "./QueueManager.ts";
import { QueueProvider } from "./provider/QueueProvider.ts";

let dir: string;
let cwd: string;
let app: Application;
let driver: DatabaseDriver;

function check() {
  const [queueCheck] = new QueueProvider(app).doctorChecks();
  return queueCheck!.run(app);
}

const record = (queue: string) => ({
  queue,
  className: "SendInvoice",
  payload: "{}",
  attempts: 0,
  maxAttempts: 3,
  retryDelay: 1000,
  availableAt: Math.floor(Date.now() / 1000),
});

beforeAll(async () => {
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "zt-queue-doctor-"));
});

afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  process.chdir(dir);
  app = Application.create({ env: "test" });
  driver = new DatabaseDriver(new SQL(":memory:") as unknown as SQLInstance);
  app.container.value("queue", new QueueManager(driver));
});

afterEach(async () => {
  process.chdir(cwd);
  await rm(join(dir, "app"), { recursive: true, force: true });
  (Application as unknown as { _resetInstance(): void })._resetInstance();
});

describe("the queue worker doctor check", () => {
  it("counts the job classes in app/jobs when nothing is waiting", async () => {
    await mkdir(join(dir, "app/jobs"), { recursive: true });
    const job = (name: string) =>
      `import { Job } from "@zerotal/queue";\nexport class ${name} extends Job {}\n`;
    await Bun.write(join(dir, "app/jobs/SendInvoice.ts"), job("SendInvoice"));
    await Bun.write(join(dir, "app/jobs/PruneExports.ts"), job("PruneExports"));
    await Bun.write(join(dir, "app/jobs/SendInvoice.test.ts"), job("SendInvoiceTest"));
    // A helper beside them is not a job, and the app/jobs check does not count it either.
    await Bun.write(join(dir, "app/jobs/helpers.ts"), "export const RETRIES = 3;\n");

    const result = await check();
    expect(result.status).toBe("ok");
    expect(result.message).toBe("2 job class(es) defined, none waiting");
  });

  it("says so when the app defines no jobs", async () => {
    const result = await check();
    expect(result.status).toBe("ok");
    expect(result.message).toBe("no job classes defined, none waiting");
  });

  it("counts jobs waiting on every queue, not only default", async () => {
    await driver.push(record("emails"));
    await driver.push(record("emails"));

    const result = await check();
    expect(result.message).toStartWith("2 job(s) waiting on emails");
  });
});
