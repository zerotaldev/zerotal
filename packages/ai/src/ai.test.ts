import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { Application, FrameworkEvents, currentApp } from "@zerotal/core";
import { LockManager, MemoryLockDriver, LockNotAcquiredError } from "@zerotal/core/lock";
import { AiConfig, validateAiConfig } from "./config.ts";
import { AiManager } from "./AiManager.ts";
import { AiFake } from "./AiFake.ts";
import { AiGenerated, AiRefused } from "./events.ts";
import {
  AiConfigError,
  AiDriverUnavailableError,
  AiRefusedError,
  AiSpendLimitError,
  UnknownAiDriverError,
} from "./errors.ts";
import { OllamaDriver } from "./drivers/OllamaDriver.ts";
import { estimateCost, modelRejectsSampling, registerModelPrice } from "./pricing.ts";
import { assertWithinLimits, recordSpend, resetSpend, spentToday } from "./spend.ts";
import { redactPrompt } from "./redact.ts";
import { modelStats, resetStats } from "./stats.ts";
import { installAiObservability } from "./observability.ts";
import type { AiDriver, DriverStatus } from "./drivers/AiDriver.ts";
import type { AiConfigShape, AiRequest, AiResponse, AiStreamChunk, AiUsage } from "./types.ts";

// ── A driver that answers from a script, with no wire format at all ─────────

const USAGE: AiUsage = {
  inputTokens: 100,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class ScriptedDriver implements AiDriver {
  readonly name = "scripted";
  readonly model = "claude-opus-5";
  readonly seen: AiRequest[] = [];

  constructor(private readonly answer = "scripted answer") {}

  async text(request: AiRequest): Promise<AiResponse> {
    this.seen.push(request);
    return {
      text: this.answer,
      model: request.model ?? this.model,
      usage: USAGE,
      stopReason: "end_turn",
      toolCalls: [],
      assistantTurn: { role: "assistant", content: this.answer },
    };
  }

  async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
    yield { type: "text", text: this.answer };
    yield { type: "done", response: await this.text(request) };
  }

  async object<T>(request: AiRequest): Promise<{ object: T; model: string; usage: AiUsage }> {
    this.seen.push(request);
    return { object: {} as T, model: this.model, usage: USAGE };
  }

  async countTokens(): Promise<number> {
    return 100;
  }

  async verify(): Promise<DriverStatus> {
    return { ok: true, model: this.model, detail: "scripted" };
  }
}

/** A config with one scripted driver registered over the top. */
function manager(overrides: Partial<AiConfigShape> = {}, driver = new ScriptedDriver()): AiManager {
  const config = AiConfig({
    drivers: { anthropic: { apiKey: "test" } },
    ...overrides,
  } as never);
  const ai = new AiManager(config);
  ai.extend("anthropic", () => driver);
  return ai;
}

// ── Config ──────────────────────────────────────────────────────────────────

describe("AiConfig", () => {
  it("defaults to claude-opus-5 with no date suffix", () => {
    const config = AiConfig({ drivers: { anthropic: { apiKey: "k" } } });
    expect(config.drivers.anthropic!.model).toBe("claude-opus-5");
  });

  it("sizes the streaming ceiling above the non-streaming one", () => {
    const config = AiConfig({ drivers: { anthropic: { apiKey: "k" } } });
    // max_tokens caps thinking *plus* text, and streaming has no HTTP timeout
    // to respect — so the two ceilings are deliberately different numbers.
    expect(config.drivers.anthropic!.maxTokens).toBe(16000);
    expect(config.drivers.anthropic!.streamMaxTokens).toBe(64000);
  });

  it("fills in defaults only for drivers the app actually declared", () => {
    const config = AiConfig({ drivers: { anthropic: { apiKey: "k" } } });
    // An openai block materialised by the merge would make "configured" and
    // "left at defaults" indistinguishable.
    expect(config.drivers.openai).toBeUndefined();
    expect(config.drivers.ollama).toBeUndefined();
  });

  it("fills in the ollama defaults when the app declares the block", () => {
    const config = AiConfig({
      default: "ollama",
      drivers: { ollama: { model: "qwen3" } },
    } as never);

    expect(config.drivers.ollama).toEqual({
      model: "qwen3",
      baseUrl: "http://127.0.0.1:11434",
      timeout: 600_000,
    });
  });

  it("rejects a default driver with no block", () => {
    expect(() =>
      AiConfig({ default: "openai", drivers: { anthropic: { apiKey: "k" } } } as never),
    ).toThrow(/default is 'openai'/);
  });

  it("accepts a config with no drivers at all — AI being off is a deployment", () => {
    // This used to throw, which combined with the empty-key throw below meant a
    // machine with no key could not express itself: naming a driver failed and
    // naming none failed. An app worked around it by declaring an Ollama server it
    // did not run, so the config said something untrue to get past the validator.
    expect(() => AiConfig({ drivers: {} })).not.toThrow();
  });

  it("still rejects a default that names a driver alongside others that exist", () => {
    // Declaring nothing means "off". Declaring some and pointing `default` at one
    // you did not declare is still a typo worth catching at boot.
    expect(() =>
      AiConfig({ default: "openai", drivers: { anthropic: { apiKey: "k" } } } as never),
    ).toThrow(/default is 'openai'/);
  });

  it("rejects an empty Anthropic key at boot rather than on the first prompt", () => {
    expect(() => AiConfig({ drivers: { anthropic: { apiKey: "" } } } as never)).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("rejects a date-suffixed model id", () => {
    expect(() =>
      AiConfig({
        drivers: { anthropic: { apiKey: "k", model: "claude-opus-5-20260101" } },
      } as never),
    ).toThrow(/date suffix/);
  });

  it("rejects a per-request ceiling above the daily one", () => {
    expect(() =>
      AiConfig({
        drivers: { anthropic: { apiKey: "k" } },
        limits: { perRequestUsd: 10, perDayUsd: 5 },
      } as never),
    ).toThrow(/could never be reached/);
  });

  it("rejects an embeddings default with no block", () => {
    expect(() =>
      AiConfig({
        drivers: { anthropic: { apiKey: "k" } },
        embeddings: { default: "cohere", drivers: { ollama: {} } },
      } as never),
    ).toThrow(/embeddings.default is 'cohere'/);
  });

  it("throws AiConfigError, not a bare Error", () => {
    const config = AiConfig({ drivers: { anthropic: { apiKey: "k" } } });
    config.agent.maxSteps = 0;
    expect(() => validateAiConfig(config)).toThrow(AiConfigError);
  });
});

// ── Pricing and spend ───────────────────────────────────────────────────────

describe("pricing", () => {
  it("prices a known model from its published rates", () => {
    // 1M input at $5 + 1M output at $25.
    const cost = estimateCost("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cost).toBeCloseTo(30, 6);
  });

  it("discounts cache reads and surcharges cache writes", () => {
    const cost = estimateCost("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // 0.1× and 1.25× of the $5 input rate.
    expect(cost).toBeCloseTo(0.5 + 6.25, 6);
  });

  it("returns 0 for an unpriced model — unpriced, not free", () => {
    expect(estimateCost("some-new-model", USAGE)).toBe(0);
  });

  it("takes a registered price for a model it did not know", () => {
    registerModelPrice("test-model-xyz", { input: 1, output: 2 });
    expect(
      estimateCost("test-model-xyz", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(1, 6);
  });

  it("assumes an unknown Claude model rejects sampling parameters", () => {
    // Guessing "accepts" fails every request against a model released after
    // this line was written; guessing "rejects" costs a dropped parameter.
    expect(modelRejectsSampling("claude-opus-5")).toBe(true);
    expect(modelRejectsSampling("claude-something-new")).toBe(true);
    expect(modelRejectsSampling("claude-opus-4-6")).toBe(false);
    expect(modelRejectsSampling("gpt-4o-mini")).toBe(false);
  });
});

describe("spend ceilings", () => {
  beforeEach(() => resetSpend());

  it("accumulates the day's cost", () => {
    recordSpend("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(spentToday()).toBeCloseTo(5, 6);
  });

  it("blocks a request whose worst case exceeds the per-request ceiling", () => {
    expect(() =>
      assertWithinLimits({ perRequestUsd: 0.01, perDayUsd: 0 }, "claude-opus-5", 1000, 64000),
    ).toThrow(AiSpendLimitError);
  });

  it("allows a request comfortably inside the ceiling", () => {
    expect(() =>
      assertWithinLimits({ perRequestUsd: 5, perDayUsd: 0 }, "claude-opus-5", 1000, 1000),
    ).not.toThrow();
  });

  it("stands aside for a model it cannot price rather than blocking everything", () => {
    expect(() =>
      assertWithinLimits({ perRequestUsd: 0.000001, perDayUsd: 0 }, "unpriced-model", 1e9, 1e9),
    ).not.toThrow();
  });

  it("blocks once the day's ceiling is reached", () => {
    recordSpend("claude-opus-5", {
      inputTokens: 2_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(() =>
      assertWithinLimits({ perRequestUsd: 0, perDayUsd: 5 }, "claude-opus-5", 1, 1),
    ).toThrow(/Daily AI spend ceiling/);
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe("redactPrompt", () => {
  it("keeps shape, not content, when redaction is on", () => {
    expect(redactPrompt("Reset the password for ada@example.com", true)).toBe(
      "[redacted 38 chars]",
    );
  });

  it("truncates rather than emitting the whole prompt when redaction is off", () => {
    const preview = redactPrompt("x".repeat(500), false);
    expect(preview.length).toBeLessThan(220);
    expect(preview.endsWith("…")).toBe(true);
  });
});

// ── Manager ─────────────────────────────────────────────────────────────────

describe("AiManager", () => {
  beforeEach(() => {
    resetSpend();
    resetStats();
  });

  it("resolves the default driver and memoizes it", () => {
    const ai = manager();
    expect(ai.driver()).toBe(ai.driver());
    expect(ai.driver().name).toBe("scripted");
  });

  it("names the configured drivers when asked for one that does not exist", () => {
    const ai = manager();
    expect(() => ai.driver("bedrock")).toThrow(UnknownAiDriverError);
    expect(() => ai.driver("bedrock")).toThrow(/Configured: anthropic/);
  });

  it("explains that embeddings need their own block", () => {
    const ai = manager();
    expect(() => ai.embeddingsDriver()).toThrow(/no embeddings endpoint/);
  });

  it("text() returns just the text; generate() returns the accounting too", async () => {
    const ai = manager();
    expect(await ai.text("hello")).toBe("scripted answer");

    const response = await ai.generate("hello");
    expect(response.usage.outputTokens).toBe(200);
    expect(response.stopReason).toBe("end_turn");
  });

  it("accepts a bare string as the prompt", async () => {
    const driver = new ScriptedDriver();
    const ai = manager({}, driver);
    await ai.text("just a string");
    expect(driver.seen[0]!.prompt).toBe("just a string");
  });

  it("emits AiGenerated with a redacted preview by default", async () => {
    const ai = manager();
    const seen: AiGenerated[] = [];
    const off = FrameworkEvents.on(AiGenerated, (e) => seen.push(e));

    await ai.text("a secret prompt");
    off();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.preview).toBe("[redacted 15 chars]");
    expect(seen[0]!.preview).not.toContain("secret");
    expect(seen[0]!.outputTokens).toBe(200);
    expect(seen[0]!.costUsd).toBeGreaterThan(0);
  });

  it("keeps the prompt when the app opts out of redaction", async () => {
    const ai = manager({ redact: false });
    const seen: AiGenerated[] = [];
    const off = FrameworkEvents.on(AiGenerated, (e) => seen.push(e));

    await ai.text("a visible prompt");
    off();

    expect(seen[0]!.preview).toBe("a visible prompt");
  });

  it("records a failure exactly once, with the error message", async () => {
    const driver = new ScriptedDriver();
    driver.text = async () => {
      throw new AiRefusedError("cyber", null);
    };

    const ai = manager({}, driver);
    const generated: AiGenerated[] = [];
    const refused: AiRefused[] = [];
    const offA = FrameworkEvents.on(AiGenerated, (e) => generated.push(e));
    const offB = FrameworkEvents.on(AiRefused, (e) => refused.push(e));

    await expect(ai.text("x")).rejects.toThrow(AiRefusedError);
    offA();
    offB();

    expect(generated).toHaveLength(1);
    expect(generated[0]!.ok).toBe(false);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.category).toBe("cyber");
  });

  it("records a stream the caller abandoned — the tokens were still paid for", async () => {
    const driver = new ScriptedDriver("one two three four five");
    const ai = manager({}, driver);
    const seen: AiGenerated[] = [];
    const off = FrameworkEvents.on(AiGenerated, (e) => seen.push(e));

    try {
      for await (const chunk of ai.stream("x")) {
        if (chunk.type === "text") break; // a cancelled Flow task looks like this
      }
    } finally {
      off();
    }

    // Without the generator's own `finally`, breaking out would leave no event
    // at all — and "cancelled streams are free" would be invisible, not true.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ok).toBe(false);
    expect(seen[0]!.operation).toBe("stream");
  });

  it("records a completed stream once, as a success", async () => {
    const ai = manager();
    const seen: AiGenerated[] = [];
    const off = FrameworkEvents.on(AiGenerated, (e) => seen.push(e));

    try {
      for await (const _chunk of ai.stream("x")) {
        /* drain */
      }
    } finally {
      off();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]!.ok).toBe(true);
  });

  it("refuses a request that would breach the per-request ceiling, before sending it", async () => {
    const driver = new ScriptedDriver();
    const ai = manager({ limits: { perRequestUsd: 0.0001, perDayUsd: 0 } }, driver);

    await expect(ai.text("x")).rejects.toThrow(AiSpendLimitError);
    // The point of a pre-flight check: the provider was never contacted.
    expect(driver.seen).toHaveLength(0);
  });

  it("skips the token count entirely when no per-request ceiling is set", async () => {
    let counted = 0;
    const driver = new ScriptedDriver();
    driver.countTokens = async () => {
      counted++;
      return 10;
    };

    const ai = manager({ limits: { perRequestUsd: 0, perDayUsd: 0 } }, driver);
    await ai.text("x");

    // Counting costs a round trip; a config with no ceiling must not pay it.
    expect(counted).toBe(0);
  });
});

// ── The agent lock ──────────────────────────────────────────────────────────

describe("AiManager.agent — locking", () => {
  beforeAll(() => Application.create());
  afterAll(() => Application._resetInstance());

  beforeEach(() => {
    resetSpend();
    currentApp().container.value("lock", new LockManager(new MemoryLockDriver()));
  });

  it("runs without a lock when the run is unnamed", async () => {
    const ai = manager();
    const result = await ai.agent({ prompt: "x" });
    expect(result.text).toBe("scripted answer");
  });

  it("holds the named lock for the duration, refusing a concurrent run of the same name", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow = new ScriptedDriver();
    slow.text = async () => {
      await gate;
      return {
        text: "done",
        model: "claude-opus-5",
        usage: USAGE,
        stopReason: "end_turn",
        toolCalls: [],
        assistantTurn: { role: "assistant", content: "done" },
      };
    };

    const ai = manager({}, slow);
    const first = ai.agent({ prompt: "x", lock: "invoice:1" });
    // Let the first run acquire before the second tries.
    await Bun.sleep(5);

    await expect(ai.agent({ prompt: "x", lock: "invoice:1" })).rejects.toThrow(
      LockNotAcquiredError,
    );

    release!();
    expect((await first).text).toBe("done");
  });

  it("does not serialize runs that named different work", async () => {
    const ai = manager();
    const [a, b] = await Promise.all([
      ai.agent({ prompt: "x", lock: "invoice:1" }),
      ai.agent({ prompt: "y", lock: "invoice:2" }),
    ]);
    expect(a.text).toBe("scripted answer");
    expect(b.text).toBe("scripted answer");
  });

  it("runs anyway when the app has no LockProvider registered", async () => {
    currentApp().container.registry.delete("lock");
    const ai = manager();
    const result = await ai.agent({ prompt: "x", lock: "invoice:1" });
    expect(result.text).toBe("scripted answer");
  });
});

// ── AiFake ──────────────────────────────────────────────────────────────────

describe("AiFake", () => {
  let fake: AiFake;

  beforeAll(() => Application.create());
  afterAll(() => Application._resetInstance());

  beforeEach(() => {
    fake = AiFake.install();
  });
  afterEach(() => fake.restore());

  it("answers from the script, in order, repeating the last", async () => {
    fake.respondWith("first", "second");

    expect(await fake.text("a")).toBe("first");
    expect(await fake.text("b")).toBe("second");
    expect(await fake.text("c")).toBe("second");
  });

  it("asserts on a prompt by substring, regex, or predicate", async () => {
    await fake.text("Summarize the quarterly report");

    expect(() => fake.assertPrompted("quarterly")).not.toThrow();
    expect(() => fake.assertPrompted(/^Summarize/)).not.toThrow();
    expect(() => fake.assertPrompted((p) => p.length > 10)).not.toThrow();
    expect(() => fake.assertPrompted("annual")).toThrow(/Expected a prompt matching "annual"/);
  });

  it("shows what was actually prompted when an assertion fails", async () => {
    await fake.text("the actual prompt");
    expect(() => fake.assertPrompted("something else")).toThrow(/the actual prompt/);
  });

  it("asserts nothing was prompted", () => {
    expect(() => fake.assertNothingPrompted()).not.toThrow();
  });

  it("counts every operation, not just text()", async () => {
    fake.respondWithObject({ ok: true });
    await fake.text("a");
    await fake.object("b");
    for await (const _chunk of fake.stream("c")) {
      /* drain */
    }

    fake.assertPromptCount(3);
  });

  it("asserts on the system prompt separately from the user turn", async () => {
    await fake.generate({ prompt: "hello", system: "You are terse." });

    expect(() => fake.assertSystemPrompted("terse")).not.toThrow();
    expect(() => fake.assertSystemPrompted("verbose")).toThrow();
  });

  it("streams in more than one chunk, so accumulation is actually exercised", async () => {
    fake.respondWith("one two three");
    const chunks: string[] = [];
    for await (const chunk of fake.stream("x")) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe("one two three");
  });

  it("can refuse on demand — the path most likely never to have run", async () => {
    fake.refuse("cyber", "Declined.");
    await expect(fake.text("x")).rejects.toThrow(AiRefusedError);
    // One refusal, not a permanent state.
    expect(await fake.text("y")).toBe("This is a fake AI response.");
  });

  it("says what to do when no object was scripted", async () => {
    await expect(fake.object("x")).rejects.toThrow(/respondWithObject/);
  });

  it("runs a queued generation's handler inline", async () => {
    const seen: string[] = [];
    fake.onGenerated("summarize", (response, meta) => {
      seen.push(`${String(meta["id"])}:${response.text}`);
    });
    fake.respondWith("a summary");

    await fake.queue({ prompt: "long text" }, { handler: "summarize", meta: { id: 7 } });
    expect(seen).toEqual(["7:a summary"]);
  });

  it("restores the original binding", () => {
    const app = currentApp();
    fake.restore();
    expect(app.container.registry.has("ai")).toBe(false);
  });
});

// ── Observability ───────────────────────────────────────────────────────────

describe("observability", () => {
  beforeAll(() => Application.create());
  afterAll(() => Application._resetInstance());

  beforeEach(() => {
    resetStats();
    resetSpend();
  });

  it("rolls generations up per model for the monitor section", async () => {
    const dispose = installAiObservability(currentApp());
    const ai = manager();

    // `finally`, not a trailing call: a listener left registered by a failing
    // test silently double-counts every event in the next one.
    try {
      await ai.text("a");
      await ai.text("b");
    } finally {
      dispose();
    }

    const stats = modelStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.model).toBe("claude-opus-5");
    expect(stats[0]!.calls).toBe(2);
    expect(stats[0]!.outputTokens).toBe(400);
    expect(stats[0]!.costUsd).toBeGreaterThan(0);
  });

  it("marks a refusal as a refusal rather than a generic failure", async () => {
    const dispose = installAiObservability(currentApp());

    const driver = new ScriptedDriver();
    driver.text = async () => {
      throw new AiRefusedError("cyber", null);
    };
    const ai = manager({}, driver);

    try {
      await expect(ai.text("x")).rejects.toThrow(AiRefusedError);
    } finally {
      dispose();
    }

    const stats = modelStats();
    expect(stats[0]!.refusals).toBe(1);
    expect(stats[0]!.failures).toBe(1);
  });
});

describe("AI turned off", () => {
  it("fails at the call, not at boot, and says so permanently", () => {
    const config = AiConfig({ drivers: {} });
    const manager = new AiManager(config);

    let thrown: unknown;
    try {
      manager.driver();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiDriverUnavailableError);
    expect((thrown as Error).message).toContain("No AI driver is configured");
    // The classification a caller latches off on: this machine cannot do this, and
    // retrying will not change that.
    expect((thrown as AiDriverUnavailableError).transient).toBe(false);
  });

  it("does not mistake 'off' for a typo", () => {
    const manager = new AiManager(AiConfig({ drivers: {} }));
    // "unknown driver 'anthropic', configured: (none)" would send someone hunting
    // for a misspelling that is not there.
    expect(() => manager.driver()).not.toThrow(/[Uu]nknown/);
  });
});

describe("countTokens", () => {
  it("returns null from a provider that cannot count, not 0", async () => {
    // 0 is a real count for an empty prompt, so a 0 meaning "unsupported" is a
    // number you can divide by and budget against without ever being told.
    const driver = new OllamaDriver({ model: "llama3.2", baseUrl: "http://x", timeout: 1000 });
    expect(await driver.countTokens({ prompt: "hello" })).toBeNull();
  });
});
