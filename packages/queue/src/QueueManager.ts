import { randomUUIDv7 } from "bun";
import {
  QueueError,
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

// ── Re-queueing a stored job ──────────────────────────────────────────────────

/**
 * Rebuild a job from its stored class name and payload, the way a worker does before it runs it:
 * through `fromPayload()` when the class declares one, otherwise a bare `new`. `undefined` when the
 * class is not registered in this process.
 *
 * @internal
 */
export function _resolveJob(className: string, payload: Record<string, unknown>): Job | undefined {
  const JobClass = JobRegistry.resolve(className);
  if (!JobClass) return undefined;
  const fromPayload = (JobClass as unknown as { fromPayload?: (p: Record<string, unknown>) => Job })
    .fromPayload;
  if (typeof fromPayload === "function") return fromPayload.call(JobClass, payload);
  return new (JobClass as new () => Job)();
}

/**
 * Queue a failed job afresh under its own class's policy: its `maxAttempts` and `retryDelay`,
 * with the attempt count reset, on `queue` (where it failed) or else the class's own. Used by
 * `retryFailed()` and `queue:retry`; the first used to push with three attempts and no delay, so a
 * job that declared one attempt, or a minute between attempts, did not get it on a retry.
 *
 * Returns `false`, and pushes nothing, when the class is not registered here: the job is already
 * in the failed table, and queueing it again under invented numbers would only put it back there.
 * The caller reports it.
 *
 * @internal
 */
export async function _requeue(
  driver: QueueDriver,
  className: string,
  payload: string,
  queue?: string,
): Promise<boolean> {
  const job = _resolveJob(className, JSON.parse(payload) as Record<string, unknown>);
  if (!job) return false;
  await pushUnderOwnPolicy(driver, job, className, payload, queue);
  return true;
}

/** Push a stored job's payload with the policy read off the job rebuilt from it. */
async function pushUnderOwnPolicy(
  driver: QueueDriver,
  job: Job,
  className: string,
  payload: string,
  queue?: string,
): Promise<void> {
  await driver.push({
    queue: queue ?? job.queue,
    className,
    payload,
    attempts: 0,
    maxAttempts: job.maxAttempts,
    retryDelay: job.retryDelay,
    availableAt: Math.floor(Date.now() / 1000),
    batchId: undefined,
  });
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

  /**
   * Re-dispatch a failed job, with its class's own `maxAttempts` and `retryDelay`, on the queue
   * it failed on, and remove it from the failed list. `false` when no failed job has that id.
   *
   * Throws a {@link QueueError} (`E_QUEUE_UNKNOWN_JOB`), and leaves the failed row in place, when
   * the job's class is not registered in this process — the same case `queue:retry` skips.
   */
  async retryFailed(id: number): Promise<boolean> {
    const rec = (await this._driver.listFailed()).find((r) => r.id === id);
    if (!rec) return false;
    if (!(await _requeue(this._driver, rec.className, rec.payload, rec.queue))) {
      throw new QueueError(
        `Cannot retry failed job ${id}: "${rec.className}" is not a registered job class, so ` +
          `there is no retry policy to queue it with. Register it with JobRegistry.register().`,
        "E_QUEUE_UNKNOWN_JOB",
        500,
        { id, className: rec.className },
      );
    }
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
      await this._queueStored(
        next.className,
        JSON.stringify(rest.length ? { ...next.payload, __chain: rest } : next.payload),
        `the next job in ${record.className}'s chain`,
        { queue: record.queue, maxAttempts: record.maxAttempts, retryDelay: record.retryDelay },
      );
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
    await this._queueStored(
      serialized.className,
      JSON.stringify(serialized.payload),
      "a batch callback job",
      { queue: "default", maxAttempts: 3, retryDelay: 1000 },
    );
  }

  /**
   * Queue a chained or batch-callback job under its own policy.
   *
   * One whose class this process does not know, or whose `fromPayload()` throws, has no policy to
   * read. It is queued anyway, under `fallback` (the numbers these paths always used), so that the
   * worker fails it into the failed-jobs table, where it can be seen and retried, instead of the
   * job disappearing into a log line. A warning names it.
   *
   * Rebuilding the job runs its own `fromPayload()` or constructor, and here that happens while
   * the previous job is completing. An error from it must not reach `_processRecord`'s catch,
   * which would retry or fail a job that already succeeded, so it is caught here.
   */
  private async _queueStored(
    className: string,
    payload: string,
    what: string,
    fallback: { queue: string; maxAttempts: number; retryDelay: number },
  ): Promise<void> {
    let job: Job | undefined;
    let problem = "is not a registered job class; register it with JobRegistry.register()";
    try {
      job = _resolveJob(className, JSON.parse(payload) as Record<string, unknown>);
    } catch (err) {
      problem = `could not be rebuilt from its payload (${err instanceof Error ? err.message : String(err)})`;
    }
    if (job) {
      await pushUnderOwnPolicy(this._driver, job, className, payload);
      return;
    }
    frameworkLog("queue").warn(
      `Queued ${what} on "${fallback.queue}" without its own policy: "${className}" ${problem}. ` +
        `The worker will move it to the failed jobs.`,
      { job: className, queue: fallback.queue },
    );
    await this._driver.push({
      queue: fallback.queue,
      className,
      payload,
      attempts: 0,
      maxAttempts: fallback.maxAttempts,
      retryDelay: fallback.retryDelay,
      availableAt: Math.floor(Date.now() / 1000),
      batchId: undefined,
    });
  }

  private _instantiate(record: JobRecord): Job | undefined {
    return _resolveJob(record.className, JSON.parse(record.payload) as Record<string, unknown>);
  }

  private _isSyncDriver(): boolean {
    return this._driver instanceof SyncDriver;
  }

  /** The driver's class name, for an error that has to name what to change. */
  private _driverName(): string {
    return this._driver.constructor.name;
  }
}
