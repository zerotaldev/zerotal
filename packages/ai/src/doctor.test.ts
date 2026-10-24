import { describe, it, expect } from "bun:test";
import type { Application } from "@zerotal/core";
import { aiPriceCheck } from "./doctor.ts";
import { registerModelPrice } from "./pricing.ts";

/**
 * A hosted model with no price costs $0 as far as this package can tell, and $0 switches the
 * spend ceilings off for it. The warning on the first request comes after the fact; this reads the
 * configuration before any request has been made.
 */
type Drivers = {
  anthropic?: { model: string };
  openai?: { model: string };
  ollama?: { model: string };
};

function appWith(drivers: Drivers, limits = { perRequestUsd: 0, perDayUsd: 0 }): Application {
  const ai = { config: { drivers, limits } };
  return { container: { tryMake: () => ai } } as unknown as Application;
}

describe("the ai-model-price check", () => {
  it("is ok when the configured model is priced", () => {
    const result = aiPriceCheck.run(appWith({ anthropic: { model: "claude-opus-5-5" } }));

    expect(result).toMatchObject({ status: "ok" });
  });

  it("warns when the configured model has no price, and names the call that fixes it", () => {
    const result = aiPriceCheck.run(appWith({ anthropic: { model: "claude-future-9" } }));

    expect(result).toMatchObject({ status: "warn" });
    expect((result as { message: string }).message).toContain("claude-future-9");
    expect((result as { fix: string }).fix).toContain('registerModelPrice("claude-future-9"');
  });

  it("says the ceilings are off for it only when there are ceilings to turn off", () => {
    const drivers = { anthropic: { model: "claude-future-9" } };

    const without = aiPriceCheck.run(appWith(drivers)) as { message: string };
    const withCeiling = aiPriceCheck.run(appWith(drivers, { perRequestUsd: 0, perDayUsd: 25 })) as {
      message: string;
    };

    expect(without.message).not.toContain("ceilings");
    expect(withCeiling.message).toContain("spend ceilings");
  });

  it("names every unpriced model, hosted ones only", () => {
    const result = aiPriceCheck.run(
      appWith({
        anthropic: { model: "claude-future-9" },
        openai: { model: "gpt-future-9" },
        ollama: { model: "llama-nobody-priced" },
      }),
    ) as { message: string; fix: string };

    expect(result.message).toContain("claude-future-9, gpt-future-9");
    expect(result.message).not.toContain("llama-nobody-priced");
  });

  it("is ok once the model has been given a price", () => {
    registerModelPrice("claude-priced-later", { input: 1, output: 5 });

    const result = aiPriceCheck.run(appWith({ anthropic: { model: "claude-priced-later" } }));

    expect(result).toMatchObject({ status: "ok" });
  });

  it("is ok, with nothing to check, for an app with only a local model", () => {
    const result = aiPriceCheck.run(appWith({ ollama: { model: "llama3.2" } }));

    expect(result).toMatchObject({ status: "ok" });
  });

  it("is ok when AI is not registered", () => {
    const app = { container: { tryMake: () => undefined } } as unknown as Application;

    expect(aiPriceCheck.run(app)).toMatchObject({ status: "ok" });
  });
});
