import type { SQLInstance } from "@zerotal/orm";
import type { QueueDriver, JobRecord, FailedRecord, BatchStatus } from "./QueueDriver.ts";
import type { BatchRecord, BatchOptions } from "../Batch.ts";

/** The database engines the database queue driver runs on. */
export type QueueDatabaseDialect = "sqlite" | "postgres" | "mysql";

/** Options for {@link DatabaseDriver}. */
export interface DatabaseDriverOptions {
  /**
   * Seconds a claimed job stays invisible before it is considered abandoned and
   * another worker may claim it. Must exceed the longest expected job runtime.
   * Default: 90.
   */
  visibilityTimeout?: number | undefined;
  /**
   * The engine behind the connection. Read from the connection itself when
   * omitted, so the app's own database connection needs no extra setting.
   */
  dialect?: QueueDatabaseDialect | undefined;
}

// Numeric columns come back as strings or bigints from some engines (BIGINT on
// PostgreSQL and MySQL), so every row is read through `Number()`.
type Num = number | string | bigint;

type JobRow = {
  id: Num;
  queue: string;
  class_name: string;
  payload: string;
  attempts: Num;
  max_attempts: Num;
  retry_delay: Num;
  available_at: Num;
  reserved_at: Num | null;
  created_at: string;
  batch_id: string | null;
  debounce_key: string | null;
};

type FailedRow = {
  id: Num;
  queue: string;
  class_name: string;
  payload: string;
  attempts: Num;
  error: string;
  failed_at: string;
};

type BatchRow = {
  id: string;
  name: string;
  total_jobs: Num;
  pending_jobs: Num;
  failed_jobs: Num;
  failed_job_ids: string;
  options: string;
  created_at: string;
  finished_at: string | null;
};

/** Bun SQL's raw-text query, which DDL needs and the ORM's connection type leaves out. */
function unsafe(sql: SQLInstance, statement: string): Promise<unknown> {
  return (sql as SQLInstance & { unsafe(query: string): Promise<unknown> }).unsafe(statement);
}

/**
 * The engine behind a Bun SQL connection: the explicit option, else what the
 * connection reports, else SQLite (the in-memory connections tests open).
 */
function detectDialect(sql: SQLInstance, explicit?: QueueDatabaseDialect): QueueDatabaseDialect {
  if (explicit) return explicit;
  const adapter = (sql as SQLInstance & { options?: { adapter?: unknown } }).options?.adapter;
  if (adapter === "postgres" || adapter === "postgresql") return "postgres";
  if (adapter === "mysql" || adapter === "mariadb") return "mysql";
  return "sqlite";
}

/**
 * The table definitions, per engine.
 *
 * SQLite keeps exactly the schema it always had, so an existing queue database
 * opens unchanged. PostgreSQL and MySQL get their own identity columns and
 * `BIGINT` timestamps. MySQL also differs in three ways: indexed text must be
 * `VARCHAR`, a `TEXT` column takes no literal default, and there is no partial
 * index, so the debounce key is enforced through a generated column instead (see
 * {@link DatabaseDriver.pushDebounced}).
 */
const DDL: Record<QueueDatabaseDialect, string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS zerotal_jobs (
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
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_failed_jobs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        queue      TEXT    NOT NULL,
        class_name TEXT    NOT NULL,
        payload    TEXT    NOT NULL,
        attempts   INTEGER NOT NULL,
        error      TEXT    NOT NULL,
        failed_at  TEXT    NOT NULL
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_job_batches (
        id             TEXT    PRIMARY KEY,
        name           TEXT    NOT NULL DEFAULT '',
        total_jobs     INTEGER NOT NULL DEFAULT 0,
        pending_jobs   INTEGER NOT NULL DEFAULT 0,
        failed_jobs    INTEGER NOT NULL DEFAULT 0,
        failed_job_ids TEXT    NOT NULL DEFAULT '[]',
        options        TEXT    NOT NULL DEFAULT '{}',
        created_at     TEXT    NOT NULL,
        finished_at    TEXT
      )`,
  ],
  postgres: [
    `CREATE TABLE IF NOT EXISTS zerotal_jobs (
        id           BIGSERIAL    PRIMARY KEY,
        queue        VARCHAR(191) NOT NULL DEFAULT 'default',
        class_name   VARCHAR(255) NOT NULL,
        payload      TEXT         NOT NULL,
        attempts     INTEGER      NOT NULL DEFAULT 0,
        max_attempts INTEGER      NOT NULL DEFAULT 3,
        retry_delay  INTEGER      NOT NULL DEFAULT 1000,
        available_at BIGINT       NOT NULL,
        reserved_at  BIGINT,
        created_at   VARCHAR(64)  NOT NULL,
        batch_id     VARCHAR(64),
        debounce_key VARCHAR(191)
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_failed_jobs (
        id         BIGSERIAL    PRIMARY KEY,
        queue      VARCHAR(191) NOT NULL,
        class_name VARCHAR(255) NOT NULL,
        payload    TEXT         NOT NULL,
        attempts   INTEGER      NOT NULL,
        error      TEXT         NOT NULL,
        failed_at  VARCHAR(64)  NOT NULL
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_job_batches (
        id             VARCHAR(64)  PRIMARY KEY,
        name           VARCHAR(255) NOT NULL DEFAULT '',
        total_jobs     INTEGER      NOT NULL DEFAULT 0,
        pending_jobs   INTEGER      NOT NULL DEFAULT 0,
        failed_jobs    INTEGER      NOT NULL DEFAULT 0,
        failed_job_ids TEXT         NOT NULL DEFAULT '[]',
        options        TEXT         NOT NULL DEFAULT '{}',
        created_at     VARCHAR(64)  NOT NULL,
        finished_at    VARCHAR(64)
      )`,
    `CREATE INDEX IF NOT EXISTS zerotal_jobs_pop_idx
       ON zerotal_jobs (queue, available_at, reserved_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS zerotal_jobs_debounce_idx
       ON zerotal_jobs (debounce_key)
       WHERE debounce_key IS NOT NULL AND reserved_at IS NULL`,
  ],
  mysql: [
    // MySQL has no CREATE INDEX IF NOT EXISTS, so the indexes are declared with
    // the table and come into being exactly when it does.
    `CREATE TABLE IF NOT EXISTS zerotal_jobs (
        id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        queue         VARCHAR(191) NOT NULL DEFAULT 'default',
        class_name    VARCHAR(255) NOT NULL,
        payload       LONGTEXT     NOT NULL,
        attempts      INT          NOT NULL DEFAULT 0,
        max_attempts  INT          NOT NULL DEFAULT 3,
        retry_delay   INT          NOT NULL DEFAULT 1000,
        available_at  BIGINT       NOT NULL,
        reserved_at   BIGINT       NULL,
        created_at    VARCHAR(64)  NOT NULL,
        batch_id      VARCHAR(64)  NULL,
        debounce_key  VARCHAR(191) NULL,
        debounce_slot VARCHAR(191) GENERATED ALWAYS AS
          (IF(reserved_at IS NULL, debounce_key, NULL)) VIRTUAL,
        INDEX zerotal_jobs_pop_idx (queue, available_at, reserved_at),
        UNIQUE INDEX zerotal_jobs_debounce_idx (debounce_slot)
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_failed_jobs (
        id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        queue      VARCHAR(191) NOT NULL,
        class_name VARCHAR(255) NOT NULL,
        payload    LONGTEXT     NOT NULL,
        attempts   INT          NOT NULL,
        error      LONGTEXT     NOT NULL,
        failed_at  VARCHAR(64)  NOT NULL
      )`,
    `CREATE TABLE IF NOT EXISTS zerotal_job_batches (
        id             VARCHAR(64)  NOT NULL PRIMARY KEY,
        name           VARCHAR(255) NOT NULL DEFAULT '',
        total_jobs     INT          NOT NULL DEFAULT 0,
        pending_jobs   INT          NOT NULL DEFAULT 0,
        failed_jobs    INT          NOT NULL DEFAULT 0,
        failed_job_ids LONGTEXT     NOT NULL,
        options        LONGTEXT     NOT NULL,
        created_at     VARCHAR(64)  NOT NULL,
        finished_at    VARCHAR(64)  NULL
      )`,
  ],
};

/**
 * The queue in the app's own database: SQLite, PostgreSQL or MySQL 8.
 *
 * Jobs live in `zerotal_jobs`, permanent failures in `zerotal_failed_jobs` and
 * batches in `zerotal_job_batches`, all created on first use. A production app
 * needs only the database it already has — no Redis — and every operation the
 * queue offers works here: delays, retries, debounce, batches and chains.
 *
 * Claiming a job is safe with any number of workers. On PostgreSQL and MySQL the
 * claim reads the next due row `FOR UPDATE SKIP LOCKED`, so concurrent workers
 * each take a different job and none waits on another's lock. SQLite serialises
 * writers, so one `UPDATE … RETURNING` is already atomic there.
 *
 * Selected with `driver: "database"` in `config/queue.ts`; `"sqlite"`, the name
 * it had before it ran on the other two engines, selects the same driver.
 */
export class DatabaseDriver implements QueueDriver {
  private _sql: SQLInstance;
  private _ready: Promise<void>;
  /** Seconds a claimed job stays invisible before it is considered abandoned. */
  private _visibilityTimeout: number;
  /** The engine behind the connection, which decides the SQL each operation sends. */
  readonly dialect: QueueDatabaseDialect;

  constructor(sql: SQLInstance, options: DatabaseDriverOptions = {}) {
    this._sql = sql;
    // 90s is a sensible retry_after default. Must exceed the longest
    // expected job runtime, or a slow (but alive) worker's job will be
    // re-claimed by another worker.
    this._visibilityTimeout = options.visibilityTimeout ?? 90;
    this.dialect = detectDialect(sql, options.dialect);
    this._ready = this._ensureTables();
  }

  private async _ensureTables(): Promise<void> {
    for (const statement of DDL[this.dialect]) {
      await unsafe(this._sql, statement);
    }
    if (this.dialect !== "sqlite") return;

    // SQLite databases created by earlier versions predate these columns.
    for (const column of ["batch_id TEXT", "reserved_at INTEGER", "debounce_key TEXT"]) {
      try {
        await unsafe(this._sql, `ALTER TABLE zerotal_jobs ADD COLUMN ${column}`);
      } catch {
        // Column already exists — safe to ignore.
      }
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
      id: Number(row.id),
      queue: row.queue,
      className: row.class_name,
      payload: row.payload,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      retryDelay: Number(row.retry_delay),
      availableAt: Number(row.available_at),
      debounceKey: row.debounce_key ?? undefined,
      createdAt: row.created_at,
      batchId: row.batch_id ?? undefined,
    };
  }

  private _mapBatchRow(row: BatchRow): BatchRecord {
    return {
      id: row.id,
      name: row.name,
      totalJobs: Number(row.total_jobs),
      pendingJobs: Number(row.pending_jobs),
      failedJobs: Number(row.failed_jobs),
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
   * On SQLite and PostgreSQL, `ON CONFLICT` targets the partial unique index on
   * `debounce_key`, which only covers unreserved rows — so a dispatch collapses
   * into a pending job and never into one a worker has already claimed. MySQL has
   * no partial index: its unique index is on a generated column that holds the
   * key only while the row is unreserved, and `ON DUPLICATE KEY UPDATE` collapses
   * into that. The update takes the *new* payload and run-at either way, because
   * the point of collapsing is that the earlier dispatch is stale.
   */
  async pushDebounced(record: Omit<JobRecord, "id" | "createdAt">, key: string): Promise<void> {
    await this._ready;
    const now = new Date().toISOString();
    const batchId = record.batchId ?? null;

    if (this.dialect === "mysql") {
      await this._sql`
        INSERT INTO zerotal_jobs
          (queue, class_name, payload, attempts, max_attempts, retry_delay, available_at, created_at, batch_id, debounce_key)
        VALUES
          (${record.queue}, ${record.className}, ${record.payload},
           ${record.attempts}, ${record.maxAttempts}, ${record.retryDelay},
           ${record.availableAt}, ${now}, ${batchId}, ${key})
        ON DUPLICATE KEY UPDATE
          available_at = VALUES(available_at),
          payload      = VALUES(payload),
          queue        = VALUES(queue),
          max_attempts = VALUES(max_attempts),
          retry_delay  = VALUES(retry_delay)
      `;
      return;
    }

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

  /**
   * Claim the next due job on `queue`, or `null` when there is none.
   *
   * A claimed row (`reserved_at` set) is invisible to other workers until the
   * visibility timeout elapses, so concurrent `queue:work` processes can never
   * double-process a job. If a worker crashes mid-job, `reserved_at` goes stale
   * and the job becomes claimable again automatically.
   */
  async pop(queue = "default"): Promise<JobRecord | null> {
    await this._ready;
    const now = Math.floor(Date.now() / 1000);
    const staleBefore = now - this._visibilityTimeout;

    if (this.dialect === "postgres") {
      // The subquery locks the row it picks and skips rows another worker holds,
      // so two workers polling at once take two different jobs and neither waits.
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
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `;
      const row = rows[0];
      return row ? this._mapRow(row) : null;
    }

    if (this.dialect === "mysql") {
      // MySQL has no UPDATE … RETURNING, so the claim is a locking read and an
      // update in one transaction. SKIP LOCKED is what keeps it safe: a second
      // worker never sees the row this one holds, and never waits for it either.
      return this._sql.begin(async (tx: SQLInstance) => {
        const rows = await tx<JobRow>`
          SELECT id, queue, class_name, payload, attempts, max_attempts, retry_delay,
                 available_at, reserved_at, created_at, batch_id, debounce_key
          FROM   zerotal_jobs
          WHERE  queue = ${queue}
            AND  available_at <= ${now}
            AND  (reserved_at IS NULL OR reserved_at <= ${staleBefore})
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;
        const row = rows[0];
        if (!row) return null;
        await tx`
          UPDATE zerotal_jobs
          SET    attempts = attempts + 1, reserved_at = ${now}
          WHERE  id = ${row.id}
        `;
        return this._mapRow({ ...row, attempts: Number(row.attempts) + 1, reserved_at: now });
      });
    }

    // SQLite: one atomic UPDATE … RETURNING. Statement-level atomicity makes an
    // explicit transaction unnecessary — the repeated reserved_at predicate on
    // the outer UPDATE guards the SELECT-then-UPDATE window.
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
    const rows = await this._sql<{ count: Num }>`
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
    const rows = await this._sql<{ queue: string; count: Num }>`
      SELECT queue, COUNT(*) as count FROM zerotal_jobs GROUP BY queue ORDER BY queue`;
    return rows.map((r) => ({ queue: r.queue, pending: Number(r.count) }));
  }

  async listFailed(queue?: string): Promise<FailedRecord[]> {
    await this._ready;
    const rows: FailedRow[] = queue
      ? await this._sql<FailedRow>`
          SELECT id, queue, class_name, payload, attempts, error, failed_at
          FROM zerotal_failed_jobs WHERE queue = ${queue} ORDER BY failed_at DESC, id DESC`
      : await this._sql<FailedRow>`
          SELECT id, queue, class_name, payload, attempts, error, failed_at
          FROM zerotal_failed_jobs ORDER BY failed_at DESC, id DESC`;

    return rows.map((r) => ({
      id: Number(r.id),
      queue: r.queue,
      className: r.class_name,
      payload: r.payload,
      attempts: Number(r.attempts),
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
      // The UPDATE takes the row lock first, so two workers finishing the last two
      // jobs of a batch at once read the counter one after the other.
      await tx`
        UPDATE zerotal_job_batches
        SET    pending_jobs = pending_jobs - 1
        WHERE  id = ${batchId}
      `;
      const rows = await tx<{ pending_jobs: Num; failed_jobs: Num }>`
        SELECT pending_jobs, failed_jobs FROM zerotal_job_batches WHERE id = ${batchId}
      `;
      const row = rows[0];
      if (!row || Number(row.pending_jobs) > 0) return "pending";

      await tx`
        UPDATE zerotal_job_batches SET finished_at = ${new Date().toISOString()} WHERE id = ${batchId}
      `;
      return Number(row.failed_jobs) > 0 ? "failed" : "complete";
    });
  }

  async recordBatchJobFailed(batchId: string, jobId: number): Promise<BatchStatus> {
    await this._ready;
    return this._sql.begin(async (tx: SQLInstance) => {
      // Read-modify-write of the failed id list: on a server, lock the row for the
      // read, or two workers failing jobs of one batch at once each append to the
      // same old list and one id is lost. SQLite serialises writers already.
      const current =
        this.dialect === "sqlite"
          ? await tx<{ failed_job_ids: string }>`
              SELECT failed_job_ids FROM zerotal_job_batches WHERE id = ${batchId}`
          : await tx<{ failed_job_ids: string }>`
              SELECT failed_job_ids FROM zerotal_job_batches WHERE id = ${batchId} FOR UPDATE`;
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
      const rows = await tx<{ pending_jobs: Num }>`
        SELECT pending_jobs FROM zerotal_job_batches WHERE id = ${batchId}
      `;
      if (!rows[0] || Number(rows[0].pending_jobs) > 0) return "pending";

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
