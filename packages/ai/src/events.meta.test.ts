import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application, FrameworkEvents } from "@zerotal/core";
import { AiManager } from "./AiManager.ts";
import { AiConfig } from "./config.ts";
import { AiFake } from "./AiFake.ts";
import { AiGenerated, AiRefused } from "./events.ts";
import { AiRefusedError } from "./errors.ts";
import type { AiDriver, DriverStatus } from "./drivers/AiDriver.ts";
import type { AiRequest, AiResponse, AiStreamChunk, AiUsage } from "./types.ts";

/**
 * Two gaps in what a listener can learn about an AI call.
 *
 * `AiGenerated` says which driver, model and operation, and what it cost, but not which part of
 * the app asked; billing by feature meant wrapping every call site in async context and reading
 * it back in a listener. A request's `meta` rides onto the event now.
 *
 * And `AiFake` replaces the manager, so none of the manager's events fired and nothing that
 * listens for them could be exercised with it. `AiFake.install({ emit: true })` emits them.
 */
const USAGE: AiUsage = {
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class Driver implements AiDriver {
  readonly name = "anthropic";
  readonly model = "claude-opus-5";
  fail: Error | undefined;

  async text(request: AiRequest): Promise<AiResponse> {
    if (this.fail) throw this.fail;
    return {
      text: "ok",
      model: request.model ?? this.model,
      usage: USAGE,
      stopReason: "end_turn",
      toolCalls: [],
      assistantTurn: { role: "assistant", content: "ok" },
    };
  }
  async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
    yield { type: "done", response: await this.text(request) };
  }
  async object<T>(): Promise<{ object: T; model: string; usage: AiUsage }> {
    return { object: {} as T, model: this.model, usage: USAGE };
  }
  async countTokens(): Promise<number> {
    return 10;
  }
  async verify(): Promise<DriverStatus> {
    return { ok: true, model: this.model, detail: "scripted" };
  }
}

function manager(driver = new Driver()): AiManager {
  const ai = new AiManager(AiConfig({ drivers: { anthropic: { apiKey: "test" } } } as never));
  ai.extend("anthropic", () => driver);
  return ai;
}

/** Collect the events a block of code emits. */
async function collect(run: () => Promise<unknown>) {
  const generated: AiGenerated[] = [];
  const refused: AiRefused[] = [];
  const offGenerated = FrameworkEvents.on(AiGenerated, (e) => generated.push(e));
  const offRefused = FrameworkEvents.on(AiRefused, (e) => refused.push(e));
  try {
    await run();
  } catch {
    // The failing cases throw on purpose; what they emitted is the point.
  } finally {
    offGenerated();
    offRefused();
  }
  return { generated, refused };
}

describe("request meta on AiGenerated", () => {
  it("carries the request's meta verbatim", async () => {
    const ai = manager();

    const { generated } = await collect(() =>
      ai.text({ prompt: "triage this", meta: { feature: "triage", householdId: 7 } }),
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]!.meta).toEqual({ feature: "triage", householdId: 7 });
  });

  it("is absent when nobody labelled the call, and the call is still counted", async () => {
    const ai = manager();

    const { generated } = await collect(() => ai.text("an unlabelled call"));

    expect(generated).toHaveLength(1);
    expect(generated[0]!.meta).toBeUndefined();
    expect(generated[0]!.outputTokens).toBe(20);
  });

  it("also rides on the event for a failed call", async () => {
    const driver = new Driver();
    driver.fail = new AiRefusedError("cyber", null);

    const { generated } = await collect(() =>
      manager(driver).text({ prompt: "x", meta: { feature: "triage" } }),
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]!.ok).toBe(false);
    expect(generated[0]!.meta).toEqual({ feature: "triage" });
  });
});

describe("AiFake.install({ emit: true })", () => {
  let fake: AiFake | undefined;

  beforeEach(async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();
  });

  afterEach(() => {
    fake?.restore();
    fake = undefined;
    Application._resetInstance();
  });

  it("emits nothing by default: most tests are about what the app asked for", async () => {
    fake = AiFake.install();

    const { generated } = await collect(() => fake!.text("hello"));

    expect(generated).toEqual([]);
  });

  it("emits AiGenerated for each kind of call, with the request's meta", async () => {
    fake = AiFake.install({ emit: true });
    fake.respondWithObject({ a: 1 });

    const { generated } = await collect(async () => {
      await fake!.text({ prompt: "t", meta: { feature: "a" } });
      await fake!.object({ prompt: "o", meta: { feature: "b" } });
      for await (const _chunk of fake!.stream({ prompt: "s", meta: { feature: "c" } })) {
        // drain
      }
      await fake!.agent({ prompt: "g", meta: { feature: "d" } });
    });

    expect(generated.map((e) => [e.operation, e.meta?.["feature"]])).toEqual([
      ["text", "a"],
      ["object", "b"],
      ["stream", "c"],
      ["agent", "d"],
    ]);
    expect(generated.every((e) => e.driver === "fake" && e.ok)).toBe(true);
  });

  it("emits AiRefused and a failed AiGenerated when the scripted call refuses", async () => {
    fake = AiFake.install({ emit: true });
    fake.refuse("cyber");

    const { generated, refused } = await collect(() =>
      fake!.text({ prompt: "x", meta: { feature: "triage" } }),
    );

    expect(refused).toHaveLength(1);
    expect(refused[0]!.category).toBe("cyber");
    expect(generated).toHaveLength(1);
    expect(generated[0]!.ok).toBe(false);
    expect(generated[0]!.meta).toEqual({ feature: "triage" });
  });
});
