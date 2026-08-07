import type { QueueDriver, JobRecord, FailedRecord } from "./QueueDriver.ts";
import type { Job } from "../Job.ts";

type SyncQueueEntry = { record: JobRecord; job: Job | undefined };

type FailedEntry = { record: JobRecord; error: string };

export class SyncDriver implements QueueDriver {
  private _queue: SyncQueueEntry[] = [];
  private _failed: FailedEntry[] = [];

  // Side channel — QueueManager sets this before calling push()
  static _pendingJob: Job | undefined = undefined;

  async push(record: Omit<JobRecord, "id" | "createdAt">): Promise<void> {
    const entry: SyncQueueEntry = {
      record: {
        ...record,
        id: this._queue.length + 1,
        createdAt: new Date().toISOString(),
      },
      job: SyncDriver._pendingJob,
    };
    this._queue.push(entry);
    SyncDriver._pendingJob = undefined;
  }

  async pop(): Promise<JobRecord | null> {
    const item = this._queue.shift();
    if (!item) return null;
    item.record.attempts += 1;
    return item.record;
  }

  async fail(record: JobRecord, error: string): Promise<void> {
    this._failed.push({ record, error });
  }

  async retry(record: JobRecord): Promise<void> {
    this._queue.unshift({ record, job: SyncDriver._pendingJob });
    SyncDriver._pendingJob = undefined;
  }

  async delete(_record: JobRecord): Promise<void> {
    // Already consumed by pop() — nothing to delete
  }

  async size(): Promise<number> {
    return this._queue.length;
  }

  async flush(): Promise<void> {
    this._queue = [];
    this._failed = [];
  }

  get failedJobs(): FailedEntry[] {
    return this._failed;
  }

  async listFailed(queue?: string): Promise<FailedRecord[]> {
    const src = queue ? this._failed.filter((f) => f.record.queue === queue) : this._failed;
    return src.map((f, i) => ({
      id: i + 1,
      queue: f.record.queue,
      className: f.record.className,
      payload: f.record.payload,
      attempts: f.record.attempts,
      error: f.error,
      failedAt: new Date().toISOString(),
    }));
  }

  async deleteFailedRecord(id: number): Promise<void> {
    this._failed.splice(id - 1, 1);
  }

  async clearFailed(queue?: string): Promise<void> {
    if (queue) {
      this._failed = this._failed.filter((f) => f.record.queue !== queue);
    } else {
      this._failed = [];
    }
  }
}
