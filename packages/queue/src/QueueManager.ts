import { randomUUIDv7 } from "bun";
import {
  QueueShuttingDownError,
  QueueBatchingUnsupportedError,
  QueueDebounceUnsupportedError,
} from "./errors.ts";
import type { QueueDriver, JobRecord } from "./drivers/QueueDriver.ts";
import type { Job } from "./Job.ts";
import type { PendingBatch } from "./PendingBatch.ts";
import type { SerializedJob } from "./Batch.ts";
import { Batch } from "./Batch.ts";
import { JobRegistry } from "./JobRegistry.ts";
import { SyncDriver } from "./drivers/SyncDriver.ts";
import { FrameworkEvents } from "@zerotal/core";
import { JobRan } from "./events.ts";
import { frameworkLog } from "@zerotal/core/logger";

export type JobStatus = "dispatched" | "completed" | "failed" | "retried";

interface JobEvent {
  className: string;
  queue: string;
  status: JobStatus;
  durationMs: number;
  error?: string | undefined;
}

function _fireJobEvent(
  className: string,
  queue: string,
  status: JobStatus,
  durationMs: number,
  error?: string,
): void {
  _recordStat({ className, queue, status, durationMs, error });
  FrameworkEvents.emit(new JobRan(className, queue, status, durationMs, error));
}

// ── Throughput stats (in-memory, best-effort — powers the admin Queue panel) ──

interface JobStat {
  t: number;
  status: JobStatus;
}
const _stats: JobStat[] = [];
let _processedTotal = 0;
let _failedTotal = 0;

function _recordStat(e: JobEvent): void {
  if (e.status === "dispatched") return;
  const now = Date.now();
  _stats.push({ t: now, status: e.status });
  if (e.status === "completed") _processedTotal++;
  else if (e.status === "failed") _failedTotal++;
  const cutoff = now - 30 * 60 * 1000; // keep ~30 min of events
  while (_stats.length && _stats[0]!.t < cutoff) _stats.shift();
  if (_stats.length > 5000) _stats.splice(0, _stats.length - 5000);
}

export interface QueueStats {
  processedTotal: number;
  failedTotal: number;
  processedLast5m: number;
  failedLast5m: number;
}

/** Best-effort in-process queue throughput counters (since boot). */
export function queueStats(): QueueStats {
  const cutoff = Date.now() - 5 * 60 * 1000;
  let p = 0,
    f = 0;
  for (const s of _stats) {
    if (s.t < cutoff) continue;
    if (s.status === "completed") p++;
    else if (s.status === "failed") f++;
  }
  return {
    processedTotal: _processedTotal,
    failedTotal: _failedTotal,
    processedLast5m: p,
    failedLast5m: f,
  };
}

// ── QueueManager ──────────────────────────────────────────────────────────────

type JobExecutor = {
  run(record: JobRecord): Promise<{ success: true } | { success: false; error: string }>;
};

export class QueueManager {
  private _driver: QueueDriver;
  private _isShuttingDown: boolean = false;
  private _activeJobCount: number = 0;
  private _drainResolve: (() => void) | undefined = undefined;
  private _executor: JobExecutor | undefined = undefined;

  constructor(driver: QueueDriver) {
    this._driver = driver;
  }

  setWorkerPool(pool: JobExecutor): void {
    this._executor = pool;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────

  async dispatch(job: Job): Promise<void> {
    if (this._isShuttingDown) {
      throw new QueueShuttingDownError(job.className);
    }

    if (this._isSyncDriver()) {
      SyncDriver._pendingJob = job;
    }

    const payload = job.payload();
    if (job._chain?.length) {
      payload["__chain"] = job._chain;
    }

    // A debounced job runs `debounce` seconds after the *last* dispatch, so each
    // one sets the run-at forward from now; the driver collapses it into whatever
    // is already pending under the same key.
    const debounceSeconds = job.debounce;
    const record = {
      queue: job.queue,
      className: job.className,
      payload: JSON.stringify(payload),
      attempts: 0,
      maxAttempts: job.maxAttempts,
      retryDelay: job.retryDelay,
      availableAt: Math.floor(Date.now() / 1000) + (debounceSeconds ?? 0),
      batchId: job.batchId,
    };

    if (debounceSeconds !== undefined && debounceSeconds > 0 && !this._isSyncDriver()) {
      if (!this._driver.pushDebounced) {
        throw new QueueDebounceUnsupportedError(job.className, this._driverName());
      }
      await this._driver.pushDebounced(record, job.debounceKey());
    } else {
      await this._driver.push(record);
    }

    _fireJobEvent(job.className, job.queue, "dispatched", 0);

    if (this._isSyncDriver()) {
      const record = await this._driver.pop(job.queue);
      if (record) await this._processRecord(record, job);
    }
  }

  async dispatchBatch(pending: PendingBatch): Promise<Batch> {
    if (!this._driver.createBatch) {
      throw new QueueBatchingUnsupportedError();
    }

    // v7 UUID: time-ordered, so persisted batch IDs sort by creation and give
    // better index locality than random v4 IDs.
    const id = randomUUIDv7();
    const options = pending.options;

    await this._driver.createBatch(
      id,
      pending.batchName,
      pending.jobs.length,
      JSON.stringify(options),
    );

    for (const job of pending.jobs) {
      job.batchId = id;
      await this.dispatch(job);
    }

    const record = await this._driver.getBatch!(id);
    return new Batch(record!);
  }

  // ── Single job processing ─────────────────────────────────────────────

  async processNext(queue = "default"): Promise<boolean> {
    const record = await this._driver.pop(queue);
    if (!record) return false;

    if (this._executor) {
      this._activeJobCount++;
      const _t0 = Date.now();
      try {
        const result = await this._executor.run(record);
        if (result.success) {
          await this._driver.delete(record);
          _fireJobEvent(record.className, record.queue, "completed", Date.now() - _t0);
          await this._onJobComplete(record);
        } else if (record.attempts >= record.maxAttempts) {
          await this._driver.fail(record, result.error);
          _fireJobEvent(record.className, record.queue, "failed", Date.now() - _t0, result.error);
          await this._onJobFailed(record);
          frameworkLog("queue").error(
            `Job ${record.className} permanently failed after ${record.attempts} attempts`,
            { job: record.className, queue: record.queue, attempts: record.attempts },
            result.error,
          );
        } else {
          await this._driver.retry(record);
          _fireJobEvent(record.className, record.queue, "retried", Date.now() - _t0, result.error);
          frameworkLog("queue").warn(
            `Job ${record.className} failed (attempt ${record.attempts}/${record.maxAttempts}) — retrying`,
            { job: record.className, queue: record.queue, attempts: record.attempts },
            result.error,
          );
        }
      } finally {
        this._activeJobCount--;
        if (this._isShuttingDown && this._activeJobCount === 0) {
          this._drainResolve?.();
        }
      }
      return true;
    }

    await this._processRecord(record);
    return true;
  }

  // ── Worker loop control ───────────────────────────────────────────────

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }
  get activeJobCount(): number {
    return this._activeJobCount;
  }

  async drain(): Promise<void> {
    this._isShuttingDown = true;
    if (this._activeJobCount === 0) return;
    return new Promise((resolve) => {
      this._drainResolve = resolve;
      setTimeout(resolve, 25_000);
    });
  }

  async size(queue = "default"): Promise<number> {
    return this._driver.size(queue);
  }

  // ── Introspection / management (used by tooling & the admin Queue panel) ──

  /** Pending (not-yet-processed) jobs, newest queues first. */
  async pending(queue?: string, limit = 50, offset = 0): Promise<JobRecord[]> {
    return this._driver.listPending ? this._driver.listPending(queue, limit, offset) : [];
  }

  /** Distinct queue names with their pending depth. */
  async queues(): Promise<{ queue: string; pending: number }[]> {
    return this._driver.queues ? this._driver.queues() : [];
  }

  /** Failed jobs, optionally for a single queue. */
  async failed(queue?: string) {
    return this._driver.listFailed(queue);
  }

  /** Re-dispatch a failed job and remove it from the failed list. */
  async retryFailed(id: number): Promise<boolean> {
    const rec = (await this._driver.listFailed()).find((r) => r.id === id);
    if (!rec) return false;
    await this._driver.push({
      queue: rec.queue,
      className: rec.className,
      payload: rec.payload,
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 0,
      availableAt: Math.floor(Date.now() / 1000),
      batchId: undefined,
    });
    await this._driver.deleteFailedRecord(id);
    return true;
  }

  /** Forget a single failed job. */
  async forgetFailed(id: number): Promise<void> {
    return this._driver.deleteFailedRecord(id);
  }

  /** Clear failed jobs, optionally for a single queue. */
  async clearFailed(queue?: string): Promise<void> {
    return this._driver.clearFailed(queue);
  }

  /** In-process throughput counters. */
  stats(): QueueStats {
    return queueStats();
  }

  async flush(): Promise<void> {
    return this._driver.flush();
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async _processRecord(record: JobRecord, jobInstance?: Job): Promise<void> {
    this._activeJobCount++;
    const _t0 = Date.now();
    let instance: Job | undefined = undefined;

    try {
      instance = jobInstance ?? this._instantiate(record);
      if (!instance) {
        await this._driver.fail(record, `Unknown job class: ${record.className}`);
        return;
      }

      await instance.handle();
      await this._driver.delete(record);
      _fireJobEvent(record.className, record.queue, "completed", Date.now() - _t0);
      await this._onJobComplete(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (record.attempts >= record.maxAttempts) {
        await this._driver.fail(record, message);
        _fireJobEvent(record.className, record.queue, "failed", Date.now() - _t0, message);
        await this._onJobFailed(record);
        frameworkLog("queue").error(
          `Job ${record.className} permanently failed after ${record.attempts} attempts`,
          { job: record.className, queue: record.queue, attempts: record.attempts },
          message,
        );
      } else {
        if (this._isSyncDriver() && instance) {
          SyncDriver._pendingJob = instance;
        }
        await this._driver.retry(record);
        _fireJobEvent(record.className, record.queue, "retried", Date.now() - _t0, message);
        frameworkLog("queue").warn(
          `Job ${record.className} failed (attempt ${record.attempts}/${record.maxAttempts}) — ` +
            `retrying in ${record.retryDelay}ms`,
          { job: record.className, queue: record.queue, attempts: record.attempts },
          message,
        );
        if (this._isSyncDriver()) {
          const nextRecord = await this._driver.pop(record.queue);
          if (nextRecord) {
            await this._processRecord(nextRecord, instance);
          }
        }
      }
    } finally {
      this._activeJobCount--;
      if (this._isShuttingDown && this._activeJobCount === 0) {
        this._drainResolve?.();
      }
    }
  }

  private async _onJobComplete(record: JobRecord): Promise<void> {
    const payload = JSON.parse(record.payload) as Record<string, unknown>;
    const chain = payload["__chain"] as SerializedJob[] | undefined;
    if (chain?.length) {
      const next = chain[0]!;
      const rest = chain.slice(1);
      await this._driver.push({
        queue: record.queue,
        className: next.className,
        payload: JSON.stringify(rest.length ? { ...next.payload, __chain: rest } : next.payload),
        attempts: 0,
        maxAttempts: record.maxAttempts,
        retryDelay: record.retryDelay,
        availableAt: Math.floor(Date.now() / 1000),
        batchId: undefined,
      });
    }

    if (record.batchId && this._driver.recordBatchJobComplete) {
      const status = await this._driver.recordBatchJobComplete(record.batchId);
      if (status !== "pending") {
        await this._dispatchBatchCallbacks(record.batchId, status);
      }
    }
  }

  private async _onJobFailed(record: JobRecord): Promise<void> {
    if (record.batchId && this._driver.recordBatchJobFailed) {
      const status = await this._driver.recordBatchJobFailed(record.batchId, record.id);
      if (status !== "pending") {
        await this._dispatchBatchCallbacks(record.batchId, status);
      }
    }
  }

  private async _dispatchBatchCallbacks(
    batchId: string,
    status: "complete" | "failed",
  ): Promise<void> {
    if (!this._driver.getBatch) return;
    const batchRecord = await this._driver.getBatch(batchId);
    if (!batchRecord) return;

    const opts = batchRecord.options;
    if (status === "complete") {
      for (const j of opts.thenJobs ?? []) await this._dispatchSerialized(j);
    } else {
      for (const j of opts.catchJobs ?? []) await this._dispatchSerialized(j);
    }
    for (const j of opts.finallyJobs ?? []) await this._dispatchSerialized(j);
  }

  private async _dispatchSerialized(serialized: SerializedJob): Promise<void> {
    await this._driver.push({
      queue: "default",
      className: serialized.className,
      payload: JSON.stringify(serialized.payload),
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
      batchId: undefined,
    });
  }

  private _instantiate(record: JobRecord): Job | undefined {
    const JobClass = JobRegistry.resolve(record.className);
    if (!JobClass) return undefined;

    const payload = JSON.parse(record.payload) as Record<string, unknown>;
    if (
      "fromPayload" in JobClass &&
      typeof (JobClass as unknown as { fromPayload?: (p: Record<string, unknown>) => Job })
        .fromPayload === "function"
    ) {
      return (
        JobClass as unknown as { fromPayload: (p: Record<string, unknown>) => Job }
      ).fromPayload(payload);
    }
    return new (JobClass as new () => Job)();
  }

  private _isSyncDriver(): boolean {
    return this._driver instanceof SyncDriver;
  }

  /** The driver's class name, for an error that has to name what to change. */
  private _driverName(): string {
    return this._driver.constructor.name;
  }
}
