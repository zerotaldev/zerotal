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
  // Sonnet 5 carried Sonnet 4.6's row — 3/15 — until 1.11.2. Every other family
  // got its own number and this one was copied, so the ceiling refused requests
  // that were 50% inside their budget and blamed the budget.
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Cache reads bill at a tenth of input; writes at a premium that depends on how
 * long the entry lives.
 *
 * Anthropic prices a **5-minute** write at 1.25x input and a **1-hour** write at
 * 2x. On Sonnet 5's $2 input rate: $0.20 per million for a read, $2.50 for a
 * 5-minute write, $4.00 for a 1-hour one.
 *
 * The two are priced separately because a single number cannot be priced two ways.
 * Until 1.14.1 this multiplied every write by 1.25, which underestimated a 1-hour
 * write by 37.5% — in the unsafe direction for a ceiling, since a limit that
 * under-counts lets spend through rather than blocking it.
 *
 * `AiUsage.cacheWrite1hTokens` carries the split, read from the `cache_creation`
 * breakdown Anthropic returns when a 1-hour cache was actually used. This driver
 * never requests one, so it is `0` unless an app reaches past it with
 * `providerOptions` — which is exactly the case that used to be mispriced.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;
/** A 1-hour cache entry costs twice input to write, against 1.25x for five minutes. */
const CACHE_WRITE_1H_MULTIPLIER = 2;

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
    // `cacheWrite1hTokens` is counted *inside* `cacheWriteTokens`, so the
    // short-lived remainder is the difference. Clamped at zero: a provider that
    // ever reported a larger 1-hour figure than the total would otherwise produce
    // a negative charge, and an estimator that can go negative is one a ceiling
    // cannot trust.
    Math.max(0, usage.cacheWriteTokens - (usage.cacheWrite1hTokens ?? 0)) *
      perInputToken *
      CACHE_WRITE_MULTIPLIER +
    (usage.cacheWrite1hTokens ?? 0) * perInputToken * CACHE_WRITE_1H_MULTIPLIER
  );
}

// Re-exported from its new home so existing imports keep working. The predicate is
// derived from the capability table now rather than from a regex over model ids —
// see `modelCapabilities.ts` for why the exceptions are listed and the default is
// the current generation.
export { modelRejectsSampling, modelCapabilities } from "./modelCapabilities.ts";
export type { ModelCapabilities } from "./modelCapabilities.ts";
