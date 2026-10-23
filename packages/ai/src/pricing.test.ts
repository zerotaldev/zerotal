import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "@zerotal/core";
import { frameworkLog } from "@zerotal/core/logger";
import { estimateCost, modelPrice, registerModelPrice } from "./pricing.ts";
import { warnIfUnpriced, _resetUnpricedWarnings } from "./spend.ts";
import type { AiLimitsConfigShape, AiUsage } from "./types.ts";

/**
 * A model with no price costs 0, and a cost of 0 turns both spend ceilings off for it. An app
 * that set `AI_MODEL` to Claude Haiku 5.5 got exactly that: ten requests billed $0.0000 on the
 * spend panel, the per-request ceiling standing aside, the daily one never accumulating, and
 * nothing anywhere saying so. The table was a release behind the models.
 */
const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

const MILLION = 1_000_000;

describe("the price table", () => {
  it.each([
    ["claude-fable-5-1", 10, 50],
    ["claude-mythos-5-1", 10, 50],
    ["claude-fable-5", 10, 50],
    ["claude-opus-5-5", 4, 20],
    ["claude-opus-5", 5, 25],
    ["claude-opus-4-8", 5, 25],
    ["claude-opus-4-6", 5, 25],
    ["claude-opus-4-5", 5, 25],
    ["claude-sonnet-5-5", 2, 10],
    ["claude-sonnet-5", 2, 10],
    ["claude-sonnet-4-6", 3, 15],
    ["claude-sonnet-4-5", 3, 15],
    ["claude-haiku-5-5", 0.1, 0.5],
    ["claude-haiku-4-5", 1, 5],
  ])("prices %s at $%d / $%d per million", (model, input, output) => {
    expect(modelPrice(model)).toMatchObject({ input, output });
  });

  it("charges something for a request to a current model", () => {
    // The Haiku run from the report: ten calls, 5,065 tokens in and 163 out in all.
    const cost = estimateCost("claude-haiku-5-5", usage({ inputTokens: 5065, outputTokens: 163 }));

    expect(cost).toBeCloseTo((5065 * 0.1 + 163 * 0.5) / MILLION, 10);
    expect(cost).toBeGreaterThan(0);
  });
});

describe("what a cache read costs", () => {
  it.each([
    ["claude-fable-5-1", 0.25],
    ["claude-mythos-5-1", 0.25],
    ["claude-opus-5-5", 0.2],
    ["claude-sonnet-5-5", 0.1],
    ["claude-fable-5", 1],
    ["claude-opus-5", 0.5],
    ["claude-sonnet-5", 0.2],
    ["claude-haiku-4-5", 0.1],
  ])("%s bills a million cache-read tokens at $%d", (model, dollars) => {
    expect(estimateCost(model, usage({ cacheReadTokens: MILLION }))).toBeCloseTo(dollars, 10);
  });
});

describe("what a Haiku 5.5 cache read costs", () => {
  // Not in the table above: a million tokens is a long prompt, which is billed at the higher tier.
  it("is $0.01 per million in a short prompt and $0.05 in a long one", () => {
    expect(estimateCost("claude-haiku-5-5", usage({ cacheReadTokens: 50_000 }))).toBeCloseTo(
      (50_000 * 0.01) / MILLION,
      10,
    );
    expect(estimateCost("claude-haiku-5-5", usage({ cacheReadTokens: MILLION }))).toBeCloseTo(
      0.05,
      10,
    );
  });
});

describe("a model priced by prompt length", () => {
  const haiku = (over: Partial<AiUsage>) => estimateCost("claude-haiku-5-5", usage(over));

  it("bills at the base rates up to 100,000 tokens of prompt", () => {
    expect(haiku({ inputTokens: 100_000, outputTokens: MILLION })).toBeCloseTo(
      (100_000 * 0.1) / MILLION + 0.5,
      10,
    );
  });

  it("bills the whole request at the higher rates once the prompt passes it", () => {
    expect(haiku({ inputTokens: 100_001, outputTokens: MILLION })).toBeCloseTo(
      (100_001 * 0.5) / MILLION + 2.5,
      10,
    );
  });

  it("counts cache reads and writes toward the prompt, because the provider does", () => {
    // 40,000 fresh + 40,000 read + 20,001 written is a 100,001-token prompt.
    const over = haiku({ inputTokens: 40_000, cacheReadTokens: 40_000, cacheWriteTokens: 20_001 });
    const under = haiku({ inputTokens: 40_000, cacheReadTokens: 40_000, cacheWriteTokens: 20_000 });

    // Long rates: reads at 0.05/M, writes at 1.25 x 0.5/M.
    expect(over).toBeCloseTo((40_000 * 0.5 + 40_000 * 0.05 + 20_001 * 0.5 * 1.25) / MILLION, 10);
    expect(over).toBeGreaterThan(under * 4);
  });

  it("is priced per request, so a short request after a long one is cheap again", () => {
    haiku({ inputTokens: 200_000 });

    expect(haiku({ inputTokens: 1000 })).toBeCloseTo((1000 * 0.1) / MILLION, 10);
  });

  it("leaves a model without a tier alone however long the prompt", () => {
    expect(estimateCost("claude-opus-5-5", usage({ inputTokens: 900_000 }))).toBeCloseTo(
      (900_000 * 4) / MILLION,
      10,
    );
  });
});

describe("warnIfUnpriced", () => {
  const limitsOn: AiLimitsConfigShape = { perRequestUsd: 0.5, perDayUsd: 5 };
  const limitsOff: AiLimitsConfigShape = { perRequestUsd: 0, perDayUsd: 0 };
  let out = "";
  let restore: () => void;

  beforeEach(() => {
    Application._resetInstance(); // no ambient app, so frameworkLog() writes to stdout
    _resetUnpricedWarnings();
    out = "";
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    restore = () => {
      process.stdout.write = original;
    };
  });

  afterEach(() => {
    restore();
    Application._resetInstance();
  });

  /** Let the async log write land, after proving the capture sees log output at all. */
  async function settled(): Promise<string> {
    await Bun.sleep(0);
    return out;
  }

  it("captures log output at all", async () => {
    // Without this, "no warning appeared" is also what a capture that never worked looks like.
    frameworkLog("probe").warn("PROBE");

    expect(await settled()).toContain("PROBE");
  });

  it("says, for an unpriced model, that the ceilings do not apply to it", async () => {
    warnIfUnpriced("claude-future-9", limitsOn);

    const text = await settled();
    expect(text).toContain("claude-future-9 has no price");
    expect(text).toContain("ceilings");
    expect(text).toContain("registerModelPrice");
  });

  it("says only that spend reads $0 when there are no ceilings to lose", async () => {
    warnIfUnpriced("claude-future-9", limitsOff);

    const text = await settled();
    expect(text).toContain("recorded as $0");
    expect(text).not.toContain("ceilings");
  });

  it("says it once per model, not once per request", async () => {
    warnIfUnpriced("claude-future-9", limitsOn);
    warnIfUnpriced("claude-future-9", limitsOn);
    warnIfUnpriced("claude-future-9", limitsOn);
    warnIfUnpriced("claude-future-10", limitsOn);

    const text = await settled();
    expect(text.split("claude-future-9 has no price").length - 1).toBe(1);
    expect(text).toContain("claude-future-10 has no price");
  });

  it("is silent for a model that has a price, including one registered by the app", async () => {
    warnIfUnpriced("claude-haiku-5-5", limitsOn);
    registerModelPrice("my-own-model", { input: 1, output: 2 });
    warnIfUnpriced("my-own-model", limitsOn);

    expect(await settled()).not.toContain("has no price");
  });
});
