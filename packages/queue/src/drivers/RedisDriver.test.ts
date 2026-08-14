import { describe, it, expect, beforeAll } from "bun:test";

// Mock the 'bun' module before importing RedisDriver so that all dynamic
// `await import("bun")` calls inside RedisDriver get the fake redis.
//
// This fake models the data structures the driver actually uses: lists (ready
// queues + failed lists), sorted sets (delayed + reserved), a set (seen queue
// names), and an integer counter (job ids) — plus the atomic-claim EVAL. It is
// deliberately close to real Redis semantics so the suite exercises real logic.
const lists: Map<string, string[]> = new Map();
const zsets: Map<string, Map<string, number>> = new Map();
const sets: Map<string, Set<string>> = new Map();
const counters: Map<string, number> = new Map();
/** Hashes — the debounce index maps a key to the delayed member holding it. */
const hashes: Map<string, Map<string, string>> = new Map();

// Back-compat handle used by the assertions below to inspect ready lists.
const mockRedisStore = lists;

function resetAll(): void {
  lists.clear();
  zsets.clear();
  sets.clear();
  counters.clear();
  hashes.clear();
}

function zrangeByScore(key: string, min: number, max: number): string[] {
  const z = zsets.get(key);
  if (!z) return [];
  return [...z.entries()]
    .filter(([, score]) => score >= min && score <= max)
    .sort((a, b) => a[1] - b[1])
    .map(([member]) => member);
}

const fakeRedis = {
  async lpush(key: string, value: string): Promise<void> {
    const list = lists.get(key) ?? [];
    list.unshift(value);
    lists.set(key, list);
  },
  async rpop(key: string): Promise<string | null> {
    const list = lists.get(key);
    if (!list || list.length === 0) return null;
    const val = list.pop()!;
    lists.set(key, list);
    return val;
  },
  async llen(key: string): Promise<number> {
    return lists.get(key)?.length ?? 0;
  },
  async lrange(key: string, _start: number, _end: number): Promise<string[]> {
    return lists.get(key) ?? [];
  },
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) {
      lists.delete(k);
      zsets.delete(k);
      sets.delete(k);
      counters.delete(k);
    }
  },
  async incr(key: string): Promise<number> {
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  },
  async sadd(key: string, member: string): Promise<void> {
    const s = sets.get(key) ?? new Set<string>();
    s.add(member);
    sets.set(key, s);
  },
  async smembers(key: string): Promise<string[]> {
    return [...(sets.get(key) ?? [])];
  },
  async send(command: string, args: string[]): Promise<unknown> {
    switch (command.toUpperCase()) {
      case "ZADD": {
        const [key, score, member] = args as [string, string, string];
        const z = zsets.get(key) ?? new Map<string, number>();
        z.set(member, Number(score));
        zsets.set(key, z);
        return 1;
      }
      case "ZRANGEBYSCORE": {
        const [key, min, max] = args as [string, string, string];
        const lo = min === "-inf" ? -Infinity : Number(min);
        const hi = max === "+inf" ? Infinity : Number(max);
        return zrangeByScore(key, lo, hi);
      }
      case "ZRANGE": {
        const [key] = args as [string];
        const z = zsets.get(key);
        if (!z) return [];
        return [...z.entries()].sort((a, b) => a[1] - b[1]).map(([member]) => member);
      }
      case "ZREM": {
        const [key, member] = args as [string, string];
        const z = zsets.get(key);
        if (!z) return 0;
        return z.delete(member) ? 1 : 0;
      }
      case "HDEL": {
        const [key, field] = args as [string, string];
        const h = hashes.get(key);
        if (!h) return 0;
        return h.delete(field) ? 1 : 0;
      }
      case "ZCARD": {
        const [key] = args as [string];
        return zsets.get(key)?.size ?? 0;
      }
      case "LREM": {
        const [key, , value] = args as [string, string, string];
        const list = lists.get(key);
        if (!list) return 0;
        const idx = list.indexOf(value);
        if (idx === -1) return 0;
        list.splice(idx, 1);
        lists.set(key, list);
        return 1;
      }
      case "EVAL": {
        const script = args[0] ?? "";

        // The debounce upsert: HGET the key, ZREM whatever it pointed at, ZADD the
        // new member, HSET the key to it. Modelled rather than stubbed, because the
        // ZREM-returns-0 case (the member was already promoted) is the whole reason
        // the script exists.
        if (script.includes("HGET")) {
          const delayedKey = args[2]!;
          const debounceKey = args[3]!;
          const key = args[4]!;
          const score = args[5]!;
          const member = args[6]!;
          const h = hashes.get(debounceKey) ?? new Map<string, string>();
          const prev = h.get(key);
          const z = zsets.get(delayedKey) ?? new Map<string, number>();
          if (prev !== undefined) z.delete(prev);
          z.set(member, Number(score));
          zsets.set(delayedKey, z);
          h.set(key, member);
          hashes.set(debounceKey, h);
          return 1;
        }

        // The driver's atomic claim, as the Lua actually behaves:
        //   RPOP KEYS[1] → attempts += 1 → ZADD KEYS[2] ARGV[1] v → return v.
        // The increment is *inside* the claim so the parked member carries it. A fake that
        // skipped it would hide exactly the defect that let poison jobs retry forever.
        const readyKey = args[2]!;
        const reservedKey = args[3]!;
        const score = args[4]!;
        const list = lists.get(readyKey);
        if (!list || list.length === 0) return false;
        let val = list.pop()!;
        lists.set(readyKey, list);
        try {
          const obj = JSON.parse(val) as { attempts?: number };
          obj.attempts = (obj.attempts ?? 0) + 1;
          val = JSON.stringify(obj);
        } catch {
          // Unparseable member — park it verbatim, as pcall(cjson.decode) does.
        }
        const z = zsets.get(reservedKey) ?? new Map<string, number>();
        z.set(val, Number(score));
        zsets.set(reservedKey, z);
        return val;
      }
      default:
        throw new Error(`fakeRedis: unhandled command ${command}`);
    }
  },
};

// The fake is handed to the driver, not installed over the `bun` module. `mock.module`
// cannot intercept a Bun builtin, so the previous wiring silently did nothing: the driver
// reached a real Redis, found none, and all fifteen cases timed out — the production queue
// backend had no working coverage while appearing to have plenty.
import { RedisDriver } from "./RedisDriver.ts";

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    queue: "default",
    className: "TestJob",
    payload: "{}",
    attempts: 0,
    maxAttempts: 3,
    retryDelay: 0,
    availableAt: Math.floor(Date.now() / 1000),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RedisDriver", () => {
  let driver: InstanceType<typeof RedisDriver>;

  beforeAll(() => {
    driver = new RedisDriver("test:", { client: fakeRedis });
  });

  it("constructor sets prefix", () => {
    const d = new RedisDriver("my:prefix:", { client: fakeRedis });
    expect(d).toBeInstanceOf(RedisDriver);
  });

  it("constructor uses default prefix", () => {
    const d = new RedisDriver(undefined, { client: fakeRedis });
    expect(d).toBeInstanceOf(RedisDriver);
  });

  it("push() adds a job to the queue", async () => {
    resetAll();
    const record = makeRecord();
    await driver.push(record as any);
    expect(mockRedisStore.get("test:default")).toHaveLength(1);
  });

  it("pop() retrieves the oldest job", async () => {
    resetAll();
    await driver.push(makeRecord({ className: "JobA" }) as any);
    await driver.push(makeRecord({ className: "JobB" }) as any);

    const job = await driver.pop("default");
    expect(job).not.toBeNull();
    expect(typeof job!.className).toBe("string");
  });

  it("pop() returns null when queue is empty", async () => {
    resetAll();
    const result = await driver.pop("empty-queue");
    expect(result).toBeNull();
  });

  it('pop() uses "default" queue when not specified', async () => {
    resetAll();
    await driver.push(makeRecord() as any);
    const result = await driver.pop();
    expect(result).not.toBeNull();
  });

  it("fail() stores job in the failed list", async () => {
    resetAll();
    const record = makeRecord();
    await driver.fail(record as any, "something went wrong");
    expect(mockRedisStore.get("test:default:failed")).toHaveLength(1);
  });

  it("retry() re-queues a failed job", async () => {
    resetAll();
    const record = makeRecord();
    await driver.retry(record as any);
    expect(mockRedisStore.get("test:default")).toHaveLength(1);
  });

  it("delete() is a no-op (job consumed by pop)", async () => {
    const record = makeRecord();
    await expect(driver.delete(record as any)).resolves.toBeUndefined();
  });

  it("size() returns the number of jobs in the queue", async () => {
    resetAll();
    expect(await driver.size()).toBe(0);
    await driver.push(makeRecord() as any);
    expect(await driver.size()).toBe(1);
    await driver.push(makeRecord() as any);
    expect(await driver.size()).toBe(2);
  });

  it('size() uses "default" queue when not specified', async () => {
    resetAll();
    await driver.push(makeRecord() as any);
    expect(await driver.size("default")).toBe(1);
  });

  it("flush() clears default queue and failed list", async () => {
    resetAll();
    await driver.push(makeRecord() as any);
    const record = await driver.pop();
    await driver.fail(record!, "err");
    await driver.flush();
    expect(await driver.size()).toBe(0);
    expect(await driver.listFailed()).toHaveLength(0);
  });

  it("listFailed() returns all failed jobs with metadata", async () => {
    resetAll();
    const record = makeRecord({ className: "FailingJob", error: "boom" });
    await driver.fail(record as any, "boom");

    const failed = await driver.listFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0]!.className).toBe("FailingJob");
    expect(failed[0]!.error).toBe("boom");
  });

  it("listFailed() filters by queue when provided", async () => {
    resetAll();
    await driver.fail(makeRecord({ queue: "emails" }) as any, "err-email");
    await driver.fail(makeRecord({ queue: "default" }) as any, "err-default");

    const emailFailed = await driver.listFailed("emails");
    expect(emailFailed).toHaveLength(1);
    expect(emailFailed[0]!.queue).toBe("emails");
  });

  it("deleteFailedRecord() removes a failed job by id across queues", async () => {
    resetAll();
    await driver.fail(makeRecord({ id: 7, queue: "emails" }) as any, "boom");
    await driver.fail(makeRecord({ id: 8, queue: "default" }) as any, "boom");
    // No queue given → search every failed list, not just default.
    await driver.deleteFailedRecord(7);
    const remaining = await driver.listFailed();
    expect(remaining.map((r) => r.id).sort()).toEqual([8]);
  });

  it("clearFailed() removes the failed list for a queue", async () => {
    resetAll();
    await driver.fail(makeRecord() as any, "err");
    await driver.clearFailed("default");
    expect(await driver.listFailed("default")).toHaveLength(0);
  });

  it('clearFailed() uses "default" when queue not specified', async () => {
    resetAll();
    await driver.fail(makeRecord() as any, "err");
    await driver.clearFailed();
    expect(await driver.listFailed()).toHaveLength(0);
  });
});

describe("RedisDriver — attempts survive a crashed worker", () => {
  it("parks the incremented count, so a reclaim does not restart at zero", async () => {
    resetAll();
    const driver = new RedisDriver("test:", { client: fakeRedis, visibilityTimeout: 0 });
    await driver.push(makeRecord({ attempts: 0 }) as never);

    // First claim: the worker is SIGKILLed before delete()/retry()/fail().
    const first = await driver.pop();
    expect(first!.attempts).toBe(1);

    // Visibility timeout of 0 makes the reservation immediately reclaimable — the shape of
    // a worker that died. Incrementing only the returned object left the parked member at
    // 0, so the job came back as brand new forever and never reached maxAttempts.
    const reclaimed = await driver.pop();
    expect(reclaimed!.id).toBe(first!.id);
    expect(reclaimed!.attempts).toBe(2);

    const third = await driver.pop();
    expect(third!.attempts).toBe(3);
  });
});

describe("RedisDriver.pushDebounced", () => {
  const soon = (): number => Math.floor(Date.now() / 1000) + 30;

  it("collapses repeated dispatches of the same key into one delayed job", async () => {
    resetAll();
    const driver = new RedisDriver("test:", { client: fakeRedis });

    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:1");
    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:1");
    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:1");

    expect(zsets.get("test:default:delayed")?.size).toBe(1);
  });

  it("keeps different keys apart", async () => {
    resetAll();
    const driver = new RedisDriver("test:", { client: fakeRedis });

    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:1");
    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:2");

    expect(zsets.get("test:default:delayed")?.size).toBe(2);
  });

  it("pushes the run-at out and keeps the newest payload", async () => {
    resetAll();
    const driver = new RedisDriver("test:", { client: fakeRedis });

    await driver.pushDebounced(
      makeRecord({ availableAt: 1_000, payload: JSON.stringify({ n: 1 }) }) as never,
      "k",
    );
    await driver.pushDebounced(
      makeRecord({ availableAt: 2_000, payload: JSON.stringify({ n: 2 }) }) as never,
      "k",
    );

    const entries = [...(zsets.get("test:default:delayed") ?? new Map()).entries()];
    expect(entries).toHaveLength(1);
    const [member, score] = entries[0] as [string, number];
    expect(score).toBe(2_000);
    expect(JSON.parse(JSON.parse(member).payload)).toEqual({ n: 2 });
  });

  it("releases the key once the job is promoted, so the next dispatch is new work", async () => {
    resetAll();
    const driver = new RedisDriver("test:", { client: fakeRedis });

    // Due immediately, so the next pop() promotes it onto the ready list.
    await driver.pushDebounced(
      makeRecord({ availableAt: Math.floor(Date.now() / 1000) - 1 }) as never,
      "reindex:1",
    );
    const claimed = await driver.pop();
    expect(claimed).not.toBeNull();

    // The mapping is gone, so this dispatches a fresh delayed job rather than
    // trying to reschedule the one a worker just took.
    await driver.pushDebounced(makeRecord({ availableAt: soon() }) as never, "reindex:1");
    expect(zsets.get("test:default:delayed")?.size).toBe(1);
  });
});
