import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { AiManager } from "./AiManager.ts";
import { AiConfig } from "./config.ts";
import { AiSpendLimitError } from "./errors.ts";
import {
  assertWithinLimits,
  isSpendShared,
  recordSpend,
  refreshSharedSpend,
  resetSpend,
  spentToday,
  useSharedSpend,
  type SharedSpendStore,
} from "./spend.ts";
import { _cacheIsShared } from "./provider/AiProvider.ts";
import type { AiDriver, DriverStatus } from "./drivers/AiDriver.ts";
import type { AiRequest, AiResponse, AiStreamChunk, AiUsage } from "./types.ts";

/**
 * A daily ceiling that is counted in one process is a ceiling per process: four workers spent
 * four times the limit, and every deploy started the day again at zero. With a cache the
 * processes share, the total is kept there, one atomic addition per request, and the ceiling is
 * checked against it.
 *
 * The store here stands in for the cache. A second process is simulated by adding to the store
 * directly, which is all another process can do to it.
 */
class Store implements SharedSpendStore {
  readonly values = new Map<string, number>();
  down = false;
  gets = 0;

  async get<T>(key: string): Promise<T | null> {
    this.gets++;
    if (this.down) throw new Error("store down");
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async increment(key: string, by: number): Promise<number> {
    if (this.down) throw new Error("store down");
    const next = (this.values.get(key) ?? 0) + by;
    this.values.set(key, next);
    return next;
  }

  /** Dollars as another process would have written them. */
  spendElsewhere(usd: number): void {
    const key = [...this.values.keys()][0] ?? `ai:spend:${new Date().toISOString().slice(0, 10)}`;
    this.values.set(key, (this.values.get(key) ?? 0) + Math.round(usd * 1_000_000));
  }
}

/** Input tokens that cost exactly `usd` on claude-opus-5 ($5 per million). */
const usageFor = (usd: number) => ({
  inputTokens: Math.round((usd / 5) * 1_000_000),
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetSpend();
  useSharedSpend(undefined);
});

afterEach(() => {
  useSharedSpend(undefined);
  resetSpend();
});

describe("the daily total with a shared ledger", () => {
  it("counts a request in the store as well as in this process", async () => {
    const store = new Store();
    useSharedSpend(store);

    recordSpend("claude-opus-5", usageFor(2));
    await tick();

    expect([...store.values.values()]).toEqual([2_000_000]);
    expect(spentToday()).toBeCloseTo(2, 6);
  });

  it("does not add the two, since the store already includes this process", async () => {
    const store = new Store();
    useSharedSpend(store);

    recordSpend("claude-opus-5", usageFor(1));
    recordSpend("claude-opus-5", usageFor(1));
    await tick();
    await refreshSharedSpend();

    expect(spentToday()).toBeCloseTo(2, 6);
  });

  it("sees what another process spent once it refreshes", async () => {
    const store = new Store();
    useSharedSpend(store);
    recordSpend("claude-opus-5", usageFor(1));
    await tick();

    store.spendElsewhere(3);
    expect(spentToday()).toBeCloseTo(1, 6); // not seen yet
    await refreshSharedSpend();

    expect(spentToday()).toBeCloseTo(4, 6);
  });

  it("keeps the total across a restart, which is a fresh process with an empty ledger", async () => {
    const store = new Store();
    useSharedSpend(store);
    recordSpend("claude-opus-5", usageFor(4));
    await tick();

    resetSpend(); // the process starts again
    useSharedSpend(store);
    await refreshSharedSpend();

    expect(spentToday()).toBeCloseTo(4, 6);
  });

  it("keeps each day under its own key", async () => {
    const store = new Store();
    useSharedSpend(store);
    recordSpend("claude-opus-5", usageFor(1));
    await tick();

    expect([...store.values.keys()][0]).toMatch(/^ai:spend:[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it("writes whole micro-dollars, so fractions of a cent do not drift", async () => {
    const store = new Store();
    useSharedSpend(store);

    // 7 input tokens on claude-opus-5 is 0.000035 dollars, which a float cannot hold exactly.
    const seven = { inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    for (let i = 0; i < 1000; i++) recordSpend("claude-opus-5", seven);
    await tick();

    expect([...store.values.values()]).toEqual([35_000]);
  });

  it("does not write a request that cost nothing, such as an unpriced model", async () => {
    const store = new Store();
    useSharedSpend(store);

    recordSpend("a-model-nobody-priced", usageFor(1));
    await tick();

    expect(store.values.size).toBe(0);
  });
});

describe("the daily ceiling with a shared ledger", () => {
  const limits = { perRequestUsd: 0, perDayUsd: 5 };

  it("trips on spend that happened in another process", async () => {
    const store = new Store();
    useSharedSpend(store);
    recordSpend("claude-opus-5", usageFor(1));
    await tick();
    store.spendElsewhere(4.5);
    await refreshSharedSpend();

    expect(() => assertWithinLimits(limits, "claude-opus-5", 1, 1)).toThrow(AiSpendLimitError);
  });

  it("stays open when the other processes have not spent enough", async () => {
    const store = new Store();
    useSharedSpend(store);
    store.spendElsewhere(2);
    await refreshSharedSpend();

    expect(() => assertWithinLimits(limits, "claude-opus-5", 1, 1)).not.toThrow();
  });

  it("is unchanged without a store: this process alone is counted", () => {
    recordSpend("claude-opus-5", usageFor(5));

    expect(isSpendShared()).toBe(false);
    expect(() => assertWithinLimits(limits, "claude-opus-5", 1, 1)).toThrow(/Daily AI spend/);
  });

  it("says in the refusal what was spent, counting the other processes", async () => {
    const store = new Store();
    useSharedSpend(store);
    store.spendElsewhere(6);
    await refreshSharedSpend();

    expect(() => assertWithinLimits(limits, "claude-opus-5", 1, 1)).toThrow(/6\.00 of .5\.00/);
  });
});

describe("a ledger that cannot be reached", () => {
  it("leaves the ceiling counting this process, rather than refusing every request", async () => {
    const store = new Store();
    useSharedSpend(store);
    recordSpend("claude-opus-5", usageFor(1));
    await tick();
    store.down = true;

    await refreshSharedSpend(); // must not throw

    expect(spentToday()).toBeCloseTo(1, 6);
    expect(() =>
      assertWithinLimits({ perRequestUsd: 0, perDayUsd: 5 }, "claude-opus-5", 1, 1),
    ).not.toThrow();
  });

  it("does not let a failed write reject into the request that made it", async () => {
    const store = new Store();
    useSharedSpend(store);
    store.down = true;

    expect(() => recordSpend("claude-opus-5", usageFor(1))).not.toThrow();
    await tick();

    expect(spentToday()).toBeCloseTo(1, 6);
  });

  it("takes the figure up again once the store is back", async () => {
    const store = new Store();
    useSharedSpend(store);
    store.down = true;
    await refreshSharedSpend();
    store.down = false;
    store.spendElsewhere(3);

    await refreshSharedSpend();

    expect(spentToday()).toBeCloseTo(3, 6);
  });
});

describe("AiManager and the shared ledger", () => {
  class Driver implements AiDriver {
    readonly name = "scripted";
    readonly model = "claude-opus-5";

    async text(_request: AiRequest): Promise<AiResponse> {
      return {
        text: "ok",
        model: this.model,
        usage: usageFor(1),
        stopReason: "end_turn",
        toolCalls: [],
        assistantTurn: { role: "assistant", content: "ok" },
      };
    }

    async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
      yield { type: "done", response: await this.text(request) };
    }

    async object<T>(_request: AiRequest): Promise<{ object: T; model: string; usage: AiUsage }> {
      return { object: {} as T, model: this.model, usage: usageFor(1) };
    }

    async countTokens(): Promise<number> {
      return 100;
    }

    async verify(): Promise<DriverStatus> {
      return { ok: true, model: this.model, detail: "scripted" };
    }
  }

  function manager(perDayUsd: number): AiManager {
    const ai = new AiManager(
      AiConfig({
        drivers: { anthropic: { apiKey: "test" } },
        limits: { perRequestUsd: 0, perDayUsd },
      } as never),
    );
    ai.extend("anthropic", () => new Driver() as never);
    return ai;
  }

  it("refuses a request once other processes have used the day", async () => {
    const store = new Store();
    useSharedSpend(store);
    store.spendElsewhere(5);

    await expect(manager(5).text("hello")).rejects.toBeInstanceOf(AiSpendLimitError);
  });

  it("reads the store only when there is a daily ceiling to check", async () => {
    const store = new Store();
    useSharedSpend(store);

    await manager(0).text("hello");

    expect(store.gets).toBe(0);
  });

  it("writes the cost of a completed request to the store", async () => {
    const store = new Store();
    useSharedSpend(store);

    await manager(100).text("hello");
    await tick();

    expect([...store.values.values()]).toEqual([1_000_000]);
  });
});

describe("which caches the provider shares the spend through", () => {
  it.each([
    ["memory", ":memory:", false],
    ["memory", "storage/cache.sqlite", false],
    ["sqlite", ":memory:", false],
    ["sqlite", "", false],
    ["sqlite", "storage/cache.sqlite", true],
    ["sqlite", "file::memory:", false],
    ["redis", ":memory:", true],
  ])("%s with path %p is shared: %p", (driver, path, shared) => {
    expect(_cacheIsShared(driver, path)).toBe(shared);
  });
});
