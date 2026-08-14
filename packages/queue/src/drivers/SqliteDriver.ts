import type { SQLInstance } from "@zerotal/orm";
import type { QueueDriver, JobRecord, FailedRecord, BatchStatus } from "./QueueDriver.ts";
import type { BatchRecord, BatchOptions } from "../Batch.ts";

type JobRow = {
  id: number;
  queue: string;
  class_name: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  retry_delay: number;
  available_at: number;
  reserved_at: number | null;
  created_at: string;
  batch_id: string | null;
  debounce_key: string | null;
};

type FailedRow = {
  id: number;
  queue: string;
  class_name: string;
  payload: string;
  attempts: number;
  error: string;
  failed_at: string;
};

type BatchRow = {
  id: string;
  name: string;
  total_jobs: number;
  pending_jobs: number;
  failed_jobs: number;
  failed_job_ids: string;
  options: string;
  created_at: string;
  finished_at: string | null;
};

export class SqliteDriver implements QueueDriver {
  private _sql: SQLInstance;
  private _ready: Promise<void>;
  /** Seconds a claimed job stays invisible before it is considered abandoned. */
  private _visibilityTimeout: number;

  constructor(sql: SQLInstance, options: { visibilityTimeout?: number } = {}) {
    this._sql = sql;
    // 90s is a sensible retry_after default. Must exceed the longest
    // expected job runtime, or a slow (but alive) worker's job will be
    // re-claimed by another worker.
    this._visibilityTimeout = options.visibilityTimeout ?? 90;
    this._ready = this._ensureTables();
  }

  private async _ensureTables(): Promise<void> {
    await this._sql`
      CREATE TABLE IF NOT EXISTS zerotal_jobs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        queue        TEXT    NOT NULL DEFAULT 'default',
        class_name   TEXT    NOT NULL,
        payload      TEXT    NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        retry_delay  INTEGER NOT NULL DEFAULT 1000,
        available_at INTEGER NOT NULL,
        reserved_at  INTEGER,
        created_at   TEXT    NOT NULL,
        batch_id     TEXT
      )
    `;
    await this._sql`
      CREATE TABLE IF NOT EXISTS zerotal_failed_jobs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        queue      TEXT    NOT NULL,
        class_name TEXT    NOT NULL,
        payload    TEXT    NOT NULL,
        attempts   INTEGER NOT NULL,
        error      TEXT    NOT NULL,
        failed_at  TEXT    NOT NULL
      )
    `;
    await this._sql`
      CREATE TABLE IF NOT EXISTS zerotal_job_batches (
        id             TEXT    PRIMARY KEY,
        name           TEXT    NOT NULL DEFAULT '',
        total_jobs     INTEGER NOT NULL DEFAULT 0,
        pending_jobs   INTEGER NOT NULL DEFAULT 0,
        failed_jobs    INTEGER NOT NULL DEFAULT 0,
        failed_job_ids TEXT    NOT NULL DEFAULT '[]',
        options        TEXT    NOT NULL DEFAULT '{}',
        created_at     TEXT    NOT NULL,
        finished_at    TEXT
      )
    `;
    // Add batch_id column to existing databases that predate this migration.
    try {
      await this._sql`ALTER TABLE zerotal_jobs ADD COLUMN batch_id TEXT`;
    } catch {
      // Column already exists — safe to ignore.
    }
    // Add reserved_at column to existing databases that predate this migration.
    try {
      await this._sql`ALTER TABLE zerotal_jobs ADD COLUMN reserved_at INTEGER`;
    } catch {
      // Column already exists — safe to ignore.
    }
    // Add debounce_key column to existing databases that predate this migration.
    try {
      await this._sql`ALTER TABLE zerotal_jobs ADD COLUMN debounce_key TEXT`;
    } catch {
      // Column already exists — safe to ignore.
    }
    await this._sql`
      CREATE INDEX IF NOT EXISTS zerotal_jobs_pop_idx
      ON zerotal_jobs (queue, available_at, reserved_at)
    `;
    // The debounce upsert's conflict target, and the thing that makes it atomic:
    // at most one *unreserved* pending job may hold a given key. Partial, so a
    // job already claimed by a worker no longer occupies the key — the next
    // dispatch is new work, not a collapse into something already running — and
    // so the overwhelming majority of jobs, which set no key, are not indexed.
    await this._sql`
      CREATE UNIQUE INDEX IF NOT EXISTS zerotal_jobs_debounce_idx
      ON zerotal_jobs (debounce_key)
      WHERE debounce_key IS NOT NULL AND reserved_at IS NULL
    `;
  }

  private _mapRow(row: JobRow): JobRecord {
    return {
      id: row.id,
      queue: row.queue,
      className: row.class_name,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      retryDelay: row.retry_delay,
      availableAt: row.available_at,
      debounceKey: row.debounce_key ?? undefined,
      createdAt: row.created_at,
      batchId: row.batch_id ?? undefined,
    };
  }

  private _mapBatchRow(row: BatchRow): BatchRecord {
    return {
      id: row.id,
      name: row.name,
      totalJobs: row.total_jobs,
      pendingJobs: row.pending_jobs,
      failedJobs: row.failed_jobs,
      failedJobIds: JSON.parse(row.failed_job_ids) as number[],
      options: JSON.parse(row.options) as BatchOptions,
      createdAt: row.created_at,
      finishedAt: row.finished_at ?? undefined,
    };
  }

  async push(record: Omit<JobRecord, "id" | "createdAt">): Promise<void> {
    await this._ready;
    const now = new Date().toISOString();
    const batchId = record.batchId ?? null;
    await this._sql`
      INSERT INTO zerotal_jobs
        (queue, class_name, payload, attempts, max_attempts, retry_delay, available_at, created_at, batch_id)
      VALUES
        (${record.queue}, ${record.className}, ${record.payload},
         ${record.attempts}, ${record.maxAttempts}, ${record.retryDelay},
         ${record.availableAt}, ${now}, ${batchId})
    `;
  }

  /**
   * One statement, so two processes dispatching at once cannot both insert.
   *
   * `ON CONFLICT` targets the partial unique index on `debounce_key`, which only
   * covers unreserved rows — so a dispatch collapses into a pending job and never
   * into one a worker has already claimed. The update takes the *new* payload and
   * run-at, because the point of collapsing is that the earlier dispatch is stale.
   */
  async pushDebounced(record: Omit<JobRecord, "id" | "createdAt">, key: string): Promise<void> {
    await this._ready;
    const now = new Date().toISOString();
    const batchId = record.batchId ?? null;
    await this._sql`
      INSERT INTO zerotal_jobs
        (queue, class_name, payload, attempts, max_attempts, retry_delay, available_at, created_at, batch_id, debounce_key)
      VALUES
        (${record.queue}, ${record.className}, ${record.payload},
         ${record.attempts}, ${record.maxAttempts}, ${record.retryDelay},
         ${record.availableAt}, ${now}, ${batchId}, ${key})
      ON CONFLICT (debounce_key) WHERE debounce_key IS NOT NULL AND reserved_at IS NULL
      DO UPDATE SET
        available_at = excluded.available_at,
        payload      = excluded.payload,
        queue        = excluded.queue,
        max_attempts = excluded.max_attempts,
        retry_delay  = excluded.retry_delay
    `;
  }

  async pop(queue = "default"): Promise<JobRecord | null> {
    await this._ready;
    const now = Math.floor(Date.now() / 1000);
    const staleBefore = now - this._visibilityTimeout;

    // Claim exactly one due job with a single atomic UPDATE … RETURNING.
    // A claimed row (reserved_at set) is invisible to other workers until the
    // visibility timeout elapses, so concurrent `queue:work` processes can
    // never double-process a job. If a worker crashes mid-job, reserved_at
    // goes stale and the job becomes claimable again automatically.
    // Statement-level atomicity in SQLite makes an explicit transaction
    // unnecessary — the repeated reserved_at predicate on the outer UPDATE
    // guards the SELECT-then-UPDATE window.
    const rows = await this._sql<JobRow>`
      UPDATE zerotal_jobs
      SET    attempts    = attempts + 1,
             reserved_at = ${now}
      WHERE  id = (
        SELECT id FROM zerotal_jobs
        WHERE  queue = ${queue}
          AND  available_at <= ${now}
          AND  (reserved_at IS NULL OR reserved_at <= ${staleBefore})
        ORDER BY id ASC
        LIMIT 1
      )
      AND (reserved_at IS NULL OR reserved_at <= ${staleBefore})
      RETURNING *
    `;

    const row = rows[0];
    return row ? this._mapRow(row) : null;
  }

  async fail(record: JobRecord, error: string): Promise<void> {
    await this._ready;
    await this._sql`
      INSERT INTO zerotal_failed_jobs
        (queue, class_name, payload, attempts, error, failed_at)
      VALUES
        (${record.queue}, ${record.className}, ${record.payload},
         ${record.attempts}, ${error}, ${new Date().toISOString()})
    `;
    await this._sql`DELETE FROM zerotal_jobs WHERE id = ${record.id}`;
  }

  async retry(record: JobRecord): Promise<void> {
    await this._ready;
    const nextAvailable = Math.floor(Date.now() / 1000) + Math.floor(record.retryDelay / 1000);
    // Release the reservation so the job is claimable once its delay elapses.
    await this._sql`
      UPDATE zerotal_jobs
      SET    available_at = ${nextAvailable},
             reserved_at  = NULL
      WHERE  id = ${record.id}
    `;
  }

  async delete(record: JobRecord): Promise<void> {
    await this._ready;
    await this._sql`DELETE FROM zerotal_jobs WHERE id = ${record.id}`;
  }

  async size(queue = "default"): Promise<number> {
    await this._ready;
    const rows = await this._sql<{ count: number }>`
      SELECT COUNT(*) as count FROM zerotal_jobs
      WHERE queue = ${queue}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async flush(): Promise<void> {
    await this._ready;
    await this._sql`DELETE FROM zerotal_jobs`;
    await this._sql`DELETE FROM zerotal_failed_jobs`;
    await this._sql`DELETE FROM zerotal_job_batches`;
  }

  async listPending(queue?: string, limit = 50, offset = 0): Promise<JobRecord[]> {
    await this._ready;
    const rows: JobRow[] = queue
      ? await this._sql<JobRow>`
          SELECT * FROM zerotal_jobs WHERE queue = ${queue}
          ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`
      : await this._sql<JobRow>`
          SELECT * FROM zerotal_jobs
          ORDER BY id ASC LIMIT ${limit} OFFSET ${offset}`;
    return rows.map((r) => this._mapRow(r));
  }

  async queues(): Promise<{ queue: string; pending: number }[]> {
    await this._ready;
    const rows = await this._sql<{ queue: string; count: number }>`
      SELECT queue, COUNT(*) as count FROM zerotal_jobs GROUP BY queue ORDER BY queue`;
    return rows.map((r) => ({ queue: r.queue, pending: Number(r.count) }));
  }

  async listFailed(queue?: string): Promise<FailedRecord[]> {
    await this._ready;
    const rows: FailedRow[] = queue
      ? await this._sql<FailedRow>`
          SELECT id, queue, class_name, payload, attempts, error, failed_at
          FROM zerotal_failed_jobs WHERE queue = ${queue} ORDER BY failed_at DESC`
      : await this._sql<FailedRow>`
          SELECT id, queue, class_name, payload, attempts, error, failed_at
          FROM zerotal_failed_jobs ORDER BY failed_at DESC`;

    return rows.map((r) => ({
      id: r.id,
      queue: r.queue,
      className: r.class_name,
      payload: r.payload,
      attempts: r.attempts,
      error: r.error,
      failedAt: r.failed_at,
    }));
  }

  async deleteFailedRecord(id: number): Promise<void> {
    await this._ready;
    await this._sql`DELETE FROM zerotal_failed_jobs WHERE id = ${id}`;
  }

  async clearFailed(queue?: string): Promise<void> {
    await this._ready;
    if (queue) {
      await this._sql`DELETE FROM zerotal_failed_jobs WHERE queue = ${queue}`;
    } else {
      await this._sql`DELETE FROM zerotal_failed_jobs`;
    }
  }

  // ── Batch support ──────────────────────────────────────────────────────────

  async createBatch(
    id: string,
    name: string,
    totalJobs: number,
    optionsJson: string,
  ): Promise<void> {
    await this._ready;
    const now = new Date().toISOString();
    await this._sql`
      INSERT INTO zerotal_job_batches
        (id, name, total_jobs, pending_jobs, failed_jobs, failed_job_ids, options, created_at)
      VALUES
        (${id}, ${name}, ${totalJobs}, ${totalJobs}, 0, '[]', ${optionsJson}, ${now})
    `;
  }

  async recordBatchJobComplete(batchId: string): Promise<BatchStatus> {
    await this._ready;
    return this._sql.begin(async (tx: SQLInstance) => {
      await tx`
        UPDATE zerotal_job_batches
        SET    pending_jobs = pending_jobs - 1
        WHERE  id = ${batchId}
      `;
      const rows = await tx<{ pending_jobs: number; failed_jobs: number }>`
        SELECT pending_jobs, failed_jobs FROM zerotal_job_batches WHERE id = ${batchId}
      `;
      const row = rows[0];
      if (!row || row.pending_jobs > 0) return "pending";

      await tx`
        UPDATE zerotal_job_batches SET finished_at = ${new Date().toISOString()} WHERE id = ${batchId}
      `;
      return row.failed_jobs > 0 ? "failed" : "complete";
    });
  }

  async recordBatchJobFailed(batchId: string, jobId: number): Promise<BatchStatus> {
    await this._ready;
    return this._sql.begin(async (tx: SQLInstance) => {
      const current = await tx<{ failed_job_ids: string }>`
        SELECT failed_job_ids FROM zerotal_job_batches WHERE id = ${batchId}
      `;
      if (!current[0]) return "pending";

      const ids = JSON.parse(current[0].failed_job_ids) as number[];
      ids.push(jobId);
      const idsJson = JSON.stringify(ids);

      await tx`
        UPDATE zerotal_job_batches
        SET    pending_jobs   = pending_jobs - 1,
               failed_jobs    = failed_jobs + 1,
               failed_job_ids = ${idsJson}
        WHERE  id = ${batchId}
      `;
      const rows = await tx<{ pending_jobs: number }>`
        SELECT pending_jobs FROM zerotal_job_batches WHERE id = ${batchId}
      `;
      if (!rows[0] || rows[0].pending_jobs > 0) return "pending";

      await tx`
        UPDATE zerotal_job_batches SET finished_at = ${new Date().toISOString()} WHERE id = ${batchId}
      `;
      return "failed";
    });
  }

  async getBatch(batchId: string): Promise<BatchRecord | null> {
    await this._ready;
    const rows = await this._sql<BatchRow>`
      SELECT * FROM zerotal_job_batches WHERE id = ${batchId}
    `;
    return rows[0] ? this._mapBatchRow(rows[0]) : null;
  }
}
