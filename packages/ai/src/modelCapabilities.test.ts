import { describe, it, expect } from "bun:test";
import { modelCapabilities, modelRejectsSampling } from "./modelCapabilities.ts";
import { modelPrice, estimateCost } from "./pricing.ts";

describe("modelCapabilities", () => {
  it("treats the current generation as sampling-free, effort-taking and adaptive", () => {
    for (const model of [
      "claude-fable-5",
      "claude-mythos-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-5",
    ]) {
      expect(modelCapabilities(model)).toEqual({
        sampling: false,
        effort: true,
        thinking: "adaptive",
      });
    }
  });

  it("lets the 4.6 pair keep sampling", () => {
    for (const model of ["claude-opus-4-6", "claude-sonnet-4-6"]) {
      expect(modelCapabilities(model).sampling).toBe(true);
      expect(modelCapabilities(model).effort).toBe(true);
    }
  });

  it("keeps effort away from the 4.5 generation, which 400s on it", () => {
    for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"]) {
      const caps = modelCapabilities(model);
      expect(caps.effort).toBe(false);
      // And the thinking shape those models actually take.
      expect(caps.thinking).toBe("budget");
      // They accept temperature perfectly well; the old regex dropped it.
      expect(caps.sampling).toBe(true);
    }
  });

  it("assumes an unrecognised claude model is current rather than legacy", () => {
    // The exceptions age out; new models keep arriving. Defaulting the other way
    // would treat every new model as legacy until someone edited this file.
    expect(modelCapabilities("claude-something-not-shipped-yet")).toEqual({
      sampling: false,
      effort: true,
      thinking: "adaptive",
    });
  });

  it("claims nothing Anthropic-specific about a non-Anthropic model", () => {
    const caps = modelCapabilities("gpt-4o-mini");
    expect(caps.effort).toBe(false);
    expect(caps.thinking).toBeNull();
    expect(modelRejectsSampling("gpt-4o-mini")).toBe(false);
  });

  it("can call every model it prices", () => {
    // The package used to advertise `claude-haiku-4-5` in the pricing table while
    // the driver sent it an `effort` it rejects — the table and the driver
    // disagreeing about which models exist. Whatever is priced must be callable.
    for (const model of ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]) {
      expect(modelPrice(model)).toBeDefined();
      const caps = modelCapabilities(model);
      // Callable means: whatever thinking shape it takes is one we can build.
      expect(
        caps.thinking === null || caps.thinking === "adaptive" || caps.thinking === "budget",
      ).toBe(true);
    }
  });
});

describe("modelRejectsSampling", () => {
  it("matches the capability table", () => {
    expect(modelRejectsSampling("claude-opus-5")).toBe(true);
    expect(modelRejectsSampling("claude-opus-4-6")).toBe(false);
    expect(modelRejectsSampling("claude-haiku-4-5")).toBe(false);
  });
});

describe("pricing", () => {
  it("prices Sonnet 5 below Sonnet 4.6 rather than copying its row", () => {
    const five = modelPrice("claude-sonnet-5")!;
    const fourSix = modelPrice("claude-sonnet-4-6")!;
    expect(five).toEqual({ input: 2, output: 10 });
    // The bug was that these were identical, which is how the copy went unnoticed.
    expect(five).not.toEqual(fourSix);
  });
});

describe("cache pricing", () => {
  it("matches Anthropic's published rates for the cache this driver asks for", () => {
    // Sonnet 5: $2/M input. Read = $0.20/M, 5-minute write = $2.50/M.
    const perMillion = (usage: Partial<Record<string, number>>) =>
      estimateCost("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        ...usage,
      } as never);

    expect(perMillion({ cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2, 6);
    expect(perMillion({ cacheWriteTokens: 1_000_000 })).toBeCloseTo(2.5, 6);
  });
});
