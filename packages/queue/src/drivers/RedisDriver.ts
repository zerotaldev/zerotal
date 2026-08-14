import type { QueueDriver, JobRecord, FailedRecord } from "./QueueDriver.ts";

/**
 * Redis queue driver, at semantic parity with {@link SqliteDriver}:
 *
 * - **Delayed jobs** (`availableAt` in the future) live in a sorted set scored
 *   by their epoch-second due time; `pop()` promotes due members onto the
 *   ready list before claiming, so delayed jobs no longer run immediately.
 * - **Visibility timeout**: a popped job is parked in a `:reserved` sorted set
 *   scored by its reservation expiry. If the worker crashes before calling
 *   `delete()`/`retry()`/`fail()`, the job is reclaimed onto the ready list
 *   once the timeout elapses — no double-processing across workers, no loss.
 * - **`retry()` honours `retryDelay`** by rescheduling through the delayed set
 *   instead of pushing straight back onto the ready list.
 * - **Real job IDs** minted from a Redis counter, so failed jobs are
 *   individually addressable and `queue:retry <id>` / `deleteFailedRecord`
 *   work (previously a no-op).
 * - **`flush()` clears every queue** ever pushed to (tracked in a queue-name
 *   set), not just `default` — mirroring SqliteDriver's full wipe.
 *
 * The claim (RPOP the ready list → ZADD the reserved set) runs as a single
 * atomic Lua `EVAL`, so a worker that dies mid-claim can never lose the job:
 * either it is still on the ready list, or it is parked in `:reserved` and
 * reclaimed after the visibility timeout. The reserved member is the exact
 * value popped from the ready list, and reservations are removed by job **id**
 * (not by byte-exact re-encoding), so `delete`/`retry`/`fail` are robust even
 * if the record round-trips through a slightly different JSON encoding.
 */
/**
 * The subset of Bun's Redis client this driver uses.
 *
 * Declared as a parameter rather than reached for directly so the driver can be driven
 * against a stand-in. `mock.module("bun", …)` cannot intercept a Bun builtin, which is why
 * the suite that tried it reached a real Redis, found none, and timed out — leaving the
 * production queue backend with no working coverage while appearing to have plenty.
 */
export interface RedisClientLike {
  incr(key: string): Promise<number | bigint>;
  lpush(key: string, value: string): Promise<unknown>;
  llen(key: string): Promise<number | bigint>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  sadd(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  send(command: string, args: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export class RedisDriver implements QueueDriver {
  private _prefix: string;
  private _visibilityTimeout: number;
  private readonly _client: RedisClientLike | undefined;

  /**
   * @param prefix - Key prefix for every key family this driver owns.
   * @param options.visibilityTimeout - Seconds a claimed job stays invisible before being
   *   reclaimed. Defaults to 90, matching `SqliteDriver`.
   * @param options.client - Redis client to use. Defaults to Bun's built-in `redis`.
   */
  constructor(
    prefix = "zerotal:jobs:",
    options: { visibilityTimeout?: number; client?: RedisClientLike } = {},
  ) {
    this._prefix = prefix;
    this._visibilityTimeout = options.visibilityTimeout ?? 90;
    this._client = options.client;
  }

  /** The Redis client: the injected one, or Bun's built-in. */
  private async _redis(): Promise<RedisClientLike> {
    if (this._client) return this._client;
    const { redis } = await import("bun");
    return redis;
  }

  private _key(queue: string): string {
    return `${this._prefix}${queue}`;
  }
  private _delayedKey(queue: string): string {
    return `${this._prefix}${queue}:delayed`;
  }
  private _reservedKey(queue: string): string {
    return `${this._prefix}${queue}:reserved`;
  }
  private _failKey(queue: string): string {
    return `${this._prefix}${queue}:failed`;
  }
  /** Hash: debounce key → the delayed-set member currently holding it. */
  private _debounceKey(queue: string): string {
    return `${this._prefix}${queue}:debounce`;
  }
  /** Set of queue names seen by push() — lets flush() find every key family. */
  private _queuesKey(): string {
    return `${this._prefix}_queues`;
  }
  private _idKey(): string {
    return `${this._prefix}_id`;
  }

  private static _now(): number {
    return Math.floor(Date.now() / 1000);
  }

  async push(record: Omit<JobRecord, "id" | "createdAt">): Promise<void> {
    const redis = await this._redis();
    const id = Number(await redis.incr(this._idKey()));
    const payload = JSON.stringify({
      ...record,
      id,
      createdAt: new Date().toISOString(),
    });
    await redis.sadd(this._queuesKey(), record.queue);
    if (record.availableAt > RedisDriver._now()) {
      // Not due yet — park in the delayed sorted set, scored by due time.
      await redis.send("ZADD", [
        this._delayedKey(record.queue),
        String(record.availableAt),
        payload,
      ]);
    } else {
      await redis.lpush(this._key(record.queue), payload);
    }
  }

  /**
   * Collapse a dispatch into whatever is already pending under the same key.
   *
   * One EVAL, because the read ("is something pending?") and the write have to be
   * one step: two processes dispatching at the same instant would otherwise both
   * see nothing pending and both enqueue, which is the failure the whole feature
   * exists to prevent.
   *
   * The hash maps key → the delayed-set member holding it. `ZREM` returning 0
   * means that member is gone — already promoted to ready, or claimed — so the
   * dispatch becomes a fresh job rather than collapsing into something running.
   */
  private static readonly _DEBOUNCE_LUA =
    // KEYS: 1 delayed zset, 2 debounce hash. ARGV: 1 key, 2 score, 3 payload.
    "local prev = redis.call('HGET', KEYS[2], ARGV[1]) " +
    "if prev then redis.call('ZREM', KEYS[1], prev) end " +
    "redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]) " +
    "redis.call('HSET', KEYS[2], ARGV[1], ARGV[3]) " +
    "return 1";

  async pushDebounced(record: Omit<JobRecord, "id" | "createdAt">, key: string): Promise<void> {
    const redis = await this._redis();
    const id = Number(await redis.incr(this._idKey()));
    const payload = JSON.stringify({
      ...record,
      id,
      createdAt: new Date().toISOString(),
      debounceKey: key,
    });
    await redis.sadd(this._queuesKey(), record.queue);
    await redis.send("EVAL", [
      RedisDriver._DEBOUNCE_LUA,
      "2",
      this._delayedKey(record.queue),
      this._debounceKey(record.queue),
      key,
      String(record.availableAt),
      payload,
    ]);
  }

  /**
   * Move every member of sorted set `from` with score ≤ `maxScore` onto the
   * ready list. `ZREM` returns 0 when another worker won the race for a
   * member, so each job is promoted exactly once even under concurrency.
   */
  private async _promoteDue(from: string, queue: string, maxScore: number): Promise<void> {
    const redis = await this._redis();
    const due = (await redis.send("ZRANGEBYSCORE", [from, "-inf", String(maxScore)])) as
      string[] | null;
    if (!due || due.length === 0) return;
    for (const member of due) {
      const removed = Number(await redis.send("ZREM", [from, member]));
      if (removed !== 1) continue;
      await redis.lpush(this._key(queue), member);
      // The job is runnable now, so it no longer holds its debounce key — the
      // next dispatch is new work rather than a reschedule of something a worker
      // is about to pick up.
      try {
        const parsed = JSON.parse(member) as { debounceKey?: string };
        if (parsed.debounceKey) {
          await redis.send("HDEL", [this._debounceKey(queue), parsed.debounceKey]);
        }
      } catch {
        // An unparseable member is already on the ready list; nothing to release.
      }
    }
  }

  /**
   * Atomically pop the tail of the ready list and park it in the reserved set,
   * in a single Lua step so a crash can't happen *between* the two commands.
   * Returns the popped raw value (or a falsey reply when the list is empty).
   */
  private static readonly _CLAIM_LUA =
    "local v = redis.call('RPOP', KEYS[1]) " +
    "if not v then return false end " +
    // Increment attempts *inside* the claim, so the value parked in the reserved set is the
    // post-increment one. Incrementing only the returned object left the stored member at
    // its pre-increment count, so a SIGKILLed worker's job was reclaimed with attempts back
    // at 0 — forever, re-poisoning a worker every visibility timeout and never reaching
    // maxAttempts. SqliteDriver persists it, so this was also a break in the parity the
    // class documents.
    "local ok, obj = pcall(cjson.decode, v) " +
    "if ok and obj then obj.attempts = (obj.attempts or 0) + 1 v = cjson.encode(obj) end " +
    "redis.call('ZADD', KEYS[2], ARGV[1], v) " +
    "return v";

  async pop(queue = "default"): Promise<JobRecord | null> {
    const redis = await this._redis();
    const now = RedisDriver._now();

    // Promote delayed jobs that have come due, and reclaim reservations whose
    // visibility timeout expired (worker crashed mid-job).
    await this._promoteDue(this._delayedKey(queue), queue, now);
    await this._promoteDue(this._reservedKey(queue), queue, now);

    // Single atomic claim: RPOP ready → bump attempts → ZADD reserved. The reserved member
    // carries the incremented count, so a job reclaimed after a worker crash resumes from
    // where it was rather than restarting at zero.
    const raw = (await redis.send("EVAL", [
      RedisDriver._CLAIM_LUA,
      "2",
      this._key(queue),
      this._reservedKey(queue),
      String(now + this._visibilityTimeout),
    ])) as string | null | false;
    if (!raw) return null;

    return JSON.parse(raw) as JobRecord;
  }

  /** Remove a job's reservation by id (members are keyed logically by job id). */
  private async _release(record: JobRecord): Promise<void> {
    const redis = await this._redis();
    const reservedKey = this._reservedKey(record.queue);
    const members = (await redis.send("ZRANGE", [reservedKey, "0", "-1"])) as string[] | null;
    if (!members) return;
    for (const member of members) {
      try {
        if ((JSON.parse(member) as JobRecord).id === record.id) {
          await redis.send("ZREM", [reservedKey, member]);
          return;
        }
      } catch {
        // Skip an unparseable member rather than aborting the release.
      }
    }
  }

  async fail(record: JobRecord, error: string): Promise<void> {
    const redis = await this._redis();
    await this._release(record);
    await redis.lpush(
      this._failKey(record.queue),
      JSON.stringify({ ...record, error, failedAt: new Date().toISOString() }),
    );
  }

  async retry(record: JobRecord): Promise<void> {
    const redis = await this._redis();
    await this._release(record);
    const nextAvailable = RedisDriver._now() + Math.floor(record.retryDelay / 1000);
    const payload = JSON.stringify({ ...record, availableAt: nextAvailable });
    if (nextAvailable > RedisDriver._now()) {
      await redis.send("ZADD", [this._delayedKey(record.queue), String(nextAvailable), payload]);
    } else {
      await redis.lpush(this._key(record.queue), payload);
    }
  }

  async delete(record: JobRecord): Promise<void> {
    // Consumed from the ready list by RPOP — only the reservation remains.
    await this._release(record);
  }

  async size(queue = "default"): Promise<number> {
    const redis = await this._redis();
    // Parity with SqliteDriver: count ready + delayed + in-flight.
    const ready = Number(await redis.llen(this._key(queue)));
    const delayed = Number(await redis.send("ZCARD", [this._delayedKey(queue)]));
    const reserved = Number(await redis.send("ZCARD", [this._reservedKey(queue)]));
    return ready + delayed + reserved;
  }

  async flush(): Promise<void> {
    const redis = await this._redis();
    const queues = (await redis.smembers(this._queuesKey())) as string[] | null;
    const names = new Set<string>(["default", ...(queues ?? [])]);
    for (const queue of names) {
      await redis.del(this._key(queue));
      await redis.del(this._delayedKey(queue));
      await redis.del(this._reservedKey(queue));
      await redis.del(this._failKey(queue));
      await redis.del(this._debounceKey(queue));
    }
    await redis.del(this._queuesKey());
    await redis.del(this._idKey());
  }

  /** Every queue name push() has seen, plus `default`. */
  private async _allQueueNames(): Promise<string[]> {
    const redis = await this._redis();
    const queues = (await redis.smembers(this._queuesKey())) as string[] | null;
    return [...new Set<string>(["default", ...(queues ?? [])])];
  }

  async listFailed(queue?: string): Promise<FailedRecord[]> {
    const redis = await this._redis();
    // Parity with SqliteDriver: with no queue given, list failures across ALL
    // queues, not just `default` — otherwise jobs failed on a named queue are
    // invisible to `queue:failed`/`queue:retry` and grow unbounded.
    const queues = queue ? [queue] : await this._allQueueNames();
    const out: FailedRecord[] = [];
    for (const q of queues) {
      const raws = (await redis.lrange(this._failKey(q), 0, -1)) as string[];
      for (const raw of raws) {
        const r = JSON.parse(raw) as JobRecord & { error?: string; failedAt?: string };
        out.push({
          id: r.id,
          queue: r.queue,
          className: r.className,
          payload: r.payload,
          attempts: r.attempts,
          error: r.error ?? "",
          failedAt: r.failedAt ?? r.createdAt,
        });
      }
    }
    return out;
  }

  async deleteFailedRecord(id: number, queue?: string): Promise<void> {
    const redis = await this._redis();
    // Failed members carry real IDs now — find the encoding and LREM it. Search
    // every queue's failed list (not just `default`) so a named-queue failure
    // can actually be forgotten/retried by id.
    const queues = queue ? [queue] : await this._allQueueNames();
    for (const q of queues) {
      const key = this._failKey(q);
      const raws = (await redis.lrange(key, 0, -1)) as string[];
      for (const raw of raws) {
        if ((JSON.parse(raw) as JobRecord).id === id) {
          await redis.send("LREM", [key, "1", raw]);
          return;
        }
      }
    }
  }

  async clearFailed(queue?: string): Promise<void> {
    const redis = await this._redis();
    const queues = queue ? [queue] : await this._allQueueNames();
    for (const q of queues) await redis.del(this._failKey(q));
  }
}
