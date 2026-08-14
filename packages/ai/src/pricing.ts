/**
 * Token prices, and what to do about models we have no price for.
 *
 * The spend panel and the ceilings both need a number per request, and the only
 * honest source is a table someone maintains. So: models we know are priced,
 * models we don't return 0 — and 0 is documented as *unpriced*, never as free.
 * A ceiling therefore never blocks a request it cannot price, which is the safe
 * direction to fail for a limit whose job is to catch runaway spend, not to be
 * the billing system.
 */
import type { AiUsage } from "./types.ts";

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * Published list prices, USD per million tokens. Keys are exact model ids.
 *
 * Extend it with {@link registerModelPrice} rather than editing this — a fork
 * of the table drifts the moment a price changes.
 */
const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads bill at roughly a tenth of input; writes at a 25% premium. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Teach the cost estimator about a model it does not know.
 *
 * @example
 * registerModelPrice("gpt-4o-mini", { input: 0.15, output: 0.6 });
 */
export function registerModelPrice(model: string, price: ModelPrice): void {
  PRICES[model] = price;
}

/** The price for a model, or `undefined` when we have none. */
export function modelPrice(model: string): ModelPrice | undefined {
  return PRICES[model];
}

/**
 * Estimated USD for one request's usage. Returns 0 for an unpriced model.
 *
 * "Estimated" is load-bearing: these are public list prices, and an account
 * with negotiated rates pays something else.
 */
export function estimateCost(model: string, usage: AiUsage): number {
  const price = PRICES[model];
  if (!price) return 0;

  const perInputToken = price.input / 1_000_000;
  const perOutputToken = price.output / 1_000_000;

  return (
    usage.inputTokens * perInputToken +
    usage.outputTokens * perOutputToken +
    usage.cacheReadTokens * perInputToken * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * perInputToken * CACHE_WRITE_MULTIPLIER
  );
}

/**
 * Whether a Claude model rejects `temperature` / `top_p` / `top_k` with a 400.
 *
 * Unknown models answer `true`. The removal has only ever gone one way, and the
 * two failure modes are not symmetric: guessing "rejects" costs a dropped
 * parameter the API would have ignored anyway, while guessing "accepts" fails
 * every single request against a model released after this line was written.
 */
export function modelRejectsSampling(model: string): boolean {
  // Opus 4.6 and Sonnet 4.6 were the last Claude models to accept sampling
  // parameters; everything before them predates the models this package targets.
  return !/^claude-(opus|sonnet)-4-6\b/.test(model) && model.startsWith("claude-");
}
