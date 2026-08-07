export interface JobRecord {
  id: number;
  queue: string;
  className: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
  retryDelay: number;
  availableAt: number;
  createdAt: string;
  batchId?: string | undefined;
}

/**
 * Result of recording a batch job outcome.
 * - `'pending'`  — batch still has unfinished jobs
 * - `'complete'` — all jobs finished, none failed
 * - `'failed'`   — all jobs finished, one or more failed
 */
export type BatchStatus = "pending" | "complete" | "failed";

export interface FailedRecord {
  id: number;
  queue: string;
  className: string;
  payload: string; // JSON string
  attempts: number;
  error: string;
  failedAt: string;
}

export interface QueueDriver {
  // ── Active queue ──────────────────────────────────────────────────────────
  push(record: Omit<JobRecord, "id" | "createdAt">): Promise<void>;
  pop(queue?: string): Promise<JobRecord | null>;
  fail(record: JobRecord, error: string): Promise<void>;
  retry(record: JobRecord): Promise<void>;
  delete(record: JobRecord): Promise<void>;
  size(queue?: string): Promise<number>;
  flush(): Promise<void>;

  // ── Introspection (optional — powers tooling / the admin Queue panel) ──────
  /** List pending jobs (paged), optionally filtered to a single queue. */
  listPending?(queue?: string, limit?: number, offset?: number): Promise<JobRecord[]>;
  /** Distinct queue names with their pending depth. */
  queues?(): Promise<{ queue: string; pending: number }[]>;

  // ── Failed job management ─────────────────────────────────────────────────
  /** Return all failed jobs, optionally filtered to a single queue. */
  listFailed(queue?: string): Promise<FailedRecord[]>;
  /** Remove a single failed job by its ID. */
  deleteFailedRecord(id: number): Promise<void>;
  /** Delete all failed jobs, optionally filtered to a single queue. */
  clearFailed(queue?: string): Promise<void>;

  // ── Batch support (optional — only implemented by SqliteDriver) ───────────
  /** Create a new batch row and return immediately. */
  createBatch?(id: string, name: string, totalJobs: number, optionsJson: string): Promise<void>;
  /** Decrement pending_jobs for a completed job; mark finished if last. */
  recordBatchJobComplete?(batchId: string): Promise<BatchStatus>;
  /** Decrement pending_jobs + increment failed_jobs; mark finished if last. */
  recordBatchJobFailed?(batchId: string, jobId: number): Promise<BatchStatus>;
  /** Look up a batch row by ID. */
  getBatch?(batchId: string): Promise<import("../Batch.ts").BatchRecord | null>;
}
