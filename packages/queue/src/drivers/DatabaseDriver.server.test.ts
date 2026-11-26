/**
 * The database queue driver against every engine it claims: SQLite always, and
 * PostgreSQL and MySQL when a server is configured.
 *
 * Until this suite, the driver's table was created with `INTEGER PRIMARY KEY
 * AUTOINCREMENT`, which PostgreSQL and MySQL both reject — so an app on either
 * engine failed on its first dispatch, and the only working background queue it
 * could have was Redis. Every other queue test opens `new SQL(":memory:")`, which
 * is how that went unnoticed.
 *
 * ```bash
 * ZT_PG_URL=postgres://postgres:postgres@localhost:5432/zerotal_test bun test src/drivers/DatabaseDriver.server.test.ts
 * ZT_MYSQL_URL=mysql://root:root@localhost:3306/zerotal_test         bun test src/drivers/DatabaseDriver.server.test.ts
 * ```
 *
 * In CI the PostgreSQL and MySQL jobs prove their server is reachable before
 * this runs, for the reason the ORM smoke suite gives: a suite that skips itself
 * reports green for exactly what it exists to catch.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { SQL } from "bun";
import type { SQLInstance } from "@zerotal/orm";
import { DatabaseDriver } from "./DatabaseDriver.ts";
import type { QueueDatabaseDialect } from "./DatabaseDriver.ts";
import { SqliteDriver } from "./SqliteDriver.ts";
import type { JobRecord } from "./QueueDriver.ts";
import { QueueManager } from "../QueueManager.ts";
import { Job } from "../Job.ts";
import { JobRegistry } from "../JobRegistry.ts";

const ENGINES: { dialect: QueueDatabaseDialect; url: string }[] = [
  { dialect: "sqlite", url: ":memory:" },
  { dialect: "postgres", url: Bun.env["ZT_PG_URL"] ?? "" },
  { dialect: "mysql", url: Bun.env["ZT_MYSQL_URL"] ?? "" },
];

const TABLES = ["zerotal_jobs", "zerotal_failed_jobs", "zerotal_job_batches"];

function record(over: Partial<Omit<JobRecord, "id" | "createdAt">> = {}) {
  return {
    queue: "default",
    className: "TestJob",
    payload: "{}",
    attempts: 0,
    maxAttempts: 3,
    retryDelay: 1000,
    availableAt: Math.floor(Date.now() / 1000),
    batchId: undefined,
    ...over,
  };
}

const ran: string[] = [];

class ServerProbeJob extends Job {
  constructor(public readonly label: string = "") {
    super();
  }
  override payload(): Record<string, unknown> {
    return { label: this.label };
  }
  static fromPayload(p: Record<string, unknown>): ServerProbeJob {
    return new ServerProbeJob(String(p["label"]));
  }
  async handle(): Promise<void> {
    ran.push(this.label);
  }
}
JobRegistry.register(ServerProbeJob as never);

for (const { dialect, url } of ENGINES) {
  (url ? describe : describe.skip)(`the database queue driver on ${dialect}`, () => {
    let sql: SQL;
    let driver: DatabaseDriver;

    async function dropTables(): Promise<void> {
      for (const t of TABLES) await sql.unsafe(`DROP TABLE IF EXISTS ${t}`);
    }

    beforeAll(async () => {
      sql = new SQL(url);
      if (dialect !== "sqlite") await dropTables();
    });

    beforeEach(async () => {
      driver = new DatabaseDriver(sql as unknown as SQLInstance);
      await driver.flush();
    });

    afterAll(async () => {
      if (dialect !== "sqlite") await dropTables();
      await sql.end();
    });

    it("reads the engine off the connection", () => {
      expect(driver.dialect).toBe(dialect);
    });

    it("creates its tables, and a second driver on the same database opens them", async () => {
      const again = new DatabaseDriver(sql as unknown as SQLInstance);
      await again.push(record());
      expect(await driver.size()).toBe(1);
    });

    it("keeps the old name working: SqliteDriver is the same driver", async () => {
      const legacy = new SqliteDriver(sql as unknown as SQLInstance);
      expect(legacy).toBeInstanceOf(DatabaseDriver);
      expect(legacy.dialect).toBe(dialect);
      await legacy.push(record());
      expect(await legacy.size()).toBe(1);
    });

    it("pops in order, counts the attempt, and does not hand a claimed job out twice", async () => {
      await driver.push(record({ payload: '{"n":1}' }));
      await driver.push(record({ payload: '{"n":2}' }));

      const first = await driver.pop();
      expect(first?.payload).toBe('{"n":1}');
      expect(first?.attempts).toBe(1);
      expect(typeof first?.id).toBe("number");

      const second = await driver.pop();
      expect(second?.payload).toBe('{"n":2}');
      expect(await driver.pop()).toBeNull();

      await driver.delete(first!);
      expect(await driver.size()).toBe(1);
    });

    it("leaves a delayed job alone until it is due", async () => {
      await driver.push(record({ availableAt: Math.floor(Date.now() / 1000) + 3600 }));
      expect(await driver.pop()).toBeNull();
      expect(await driver.size()).toBe(1);
    });

    it("pops only from the queue asked for", async () => {
      await driver.push(record({ queue: "emails" }));
      expect(await driver.pop("default")).toBeNull();
      expect((await driver.pop("emails"))?.queue).toBe("emails");
    });

    it("releases a retried job and holds it for its delay", async () => {
      await driver.push(record({ retryDelay: 60_000 }));
      const job = (await driver.pop())!;
      await driver.retry(job);
      expect(await driver.pop()).toBeNull();
      const [pending] = await driver.listPending();
      expect(pending!.availableAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);
    });

    it("reclaims a job whose worker went quiet past the visibility timeout", async () => {
      const impatient = new DatabaseDriver(sql as unknown as SQLInstance, {
        visibilityTimeout: -1,
      });
      await impatient.push(record());
      const first = (await impatient.pop())!;
      const again = await impatient.pop();
      expect(again?.id).toBe(first.id);
      expect(again?.attempts).toBe(2);
    });

    it("moves a failed job to the failed table, and lists, forgets and clears it", async () => {
      await driver.push(record({ queue: "billing" }));
      await driver.push(record());
      await driver.fail((await driver.pop("billing"))!, "card declined");
      await driver.fail((await driver.pop())!, "boom");

      expect(await driver.size("billing")).toBe(0);
      const failed = await driver.listFailed();
      expect(failed.map((f) => f.error).sort()).toEqual(["boom", "card declined"]);
      expect((await driver.listFailed("billing")).map((f) => f.error)).toEqual(["card declined"]);
      expect(typeof failed[0]!.id).toBe("number");

      await driver.deleteFailedRecord(failed.find((f) => f.queue === "billing")!.id);
      expect(await driver.listFailed("billing")).toEqual([]);
      await driver.clearFailed();
      expect(await driver.listFailed()).toEqual([]);
    });

    it("pages pending jobs and reports depth per queue", async () => {
      for (let i = 0; i < 5; i++) await driver.push(record({ payload: `{"i":${i}}` }));
      await driver.push(record({ queue: "emails" }));

      const page = await driver.listPending("default", 2, 1);
      expect(page.map((r) => r.payload)).toEqual(['{"i":1}', '{"i":2}']);
      expect(await driver.queues()).toEqual([
        { queue: "default", pending: 5 },
        { queue: "emails", pending: 1 },
      ]);
    });

    it("collapses debounced dispatches into one pending job carrying the last payload", async () => {
      const at = Math.floor(Date.now() / 1000) + 30;
      await driver.pushDebounced(record({ payload: '{"v":1}', availableAt: at }), "doc:1");
      await driver.pushDebounced(record({ payload: '{"v":2}', availableAt: at + 5 }), "doc:1");
      await driver.pushDebounced(record({ payload: '{"v":9}', availableAt: at }), "doc:2");

      const pending = await driver.listPending();
      expect(pending).toHaveLength(2);
      const doc1 = pending.find((r) => r.debounceKey === "doc:1")!;
      expect(doc1.payload).toBe('{"v":2}');
      expect(doc1.availableAt).toBe(at + 5);
    });

    it("never collapses into a job a worker has already claimed", async () => {
      await driver.pushDebounced(record({ payload: '{"v":1}' }), "doc:1");
      const claimed = (await driver.pop())!;
      expect(claimed.debounceKey).toBe("doc:1");

      await driver.pushDebounced(record({ payload: '{"v":2}' }), "doc:1");
      expect(await driver.size()).toBe(2);
    });

    it("hands each job to exactly one of many workers polling at once", async () => {
      const total = 40;
      for (let i = 0; i < total; i++) await driver.push(record({ payload: `{"i":${i}}` }));

      const claimed: number[] = [];
      const worker = async () => {
        for (;;) {
          const job = await driver.pop();
          if (!job) return;
          claimed.push(job.id);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));

      expect(claimed).toHaveLength(total);
      expect(new Set(claimed).size).toBe(total);
    });

    it("counts a batch down to complete, and records every failure under contention", async () => {
      await driver.createBatch("b-ok", "ok", 2, "{}");
      expect(await driver.recordBatchJobComplete("b-ok")).toBe("pending");
      expect(await driver.recordBatchJobComplete("b-ok")).toBe("complete");
      expect((await driver.getBatch("b-ok"))!.finishedAt).toBeDefined();

      const n = 6;
      await driver.createBatch("b-bad", "bad", n, "{}");
      // Concurrently on a server, where each call gets its own pooled connection. One
      // SQLite connection cannot hold two transactions at once, and a SQLite app's
      // workers are separate processes with connections of their own.
      const fail = (i: number) => driver.recordBatchJobFailed("b-bad", i + 1);
      const statuses: string[] = [];
      if (dialect === "sqlite") for (let i = 0; i < n; i++) statuses.push(await fail(i));
      else statuses.push(...(await Promise.all(Array.from({ length: n }, (_, i) => fail(i)))));
      expect(statuses.filter((s) => s === "failed")).toHaveLength(1);
      const batch = (await driver.getBatch("b-bad"))!;
      expect(batch.failedJobs).toBe(n);
      expect(batch.pendingJobs).toBe(0);
      expect([...batch.failedJobIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("runs dispatched jobs end to end through the queue manager", async () => {
      ran.length = 0;
      const manager = new QueueManager(driver);
      await manager.dispatch(new ServerProbeJob("a"));
      await manager.dispatch(new ServerProbeJob("b"));

      expect(await manager.settle()).toBe(2);
      expect(ran).toEqual(["a", "b"]);
      expect(await manager.size()).toBe(0);
    });
  });
}
