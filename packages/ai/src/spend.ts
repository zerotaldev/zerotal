/**
 * Spend ceilings and the running spend ledger.
 *
 * Two guards, both cheap, both approximate on purpose:
 *
 * - **Per-request** is checked *before* the call, from a token estimate, because
 *   after the call the money is already spent. It bounds the blast radius of one
 *   runaway prompt.
 * - **Per-day** is checked from actual reported usage, accumulated in-process.
 *   In-process is a real limitation — N workers get N ceilings — and it is
 *   stated rather than hidden, because the alternative (a shared counter behind
 *   the cache) buys precision for an availability dependency on the hot path.
 *
 * A model with no price contributes 0 and is never blocked. See `pricing.ts`.
 */
import { frameworkLog } from "@zerotal/core/logger";
import { AiSpendLimitError } from "./errors.ts";
import { estimateCost, modelPrice } from "./pricing.ts";
import type { AiLimitsConfigShape, AiUsage } from "./types.ts";

/** Models already reported as unpriced, so the warning is one line and not one per request. */
const _warnedUnpriced = new Set<string>();

/**
 * Say, once per model, that a model has no price.
 *
 * An unpriced model costs 0 as far as this package can tell, and 0 turns the spend ceilings off
 * for it: they stand aside rather than block a model they cannot price. That is the right
 * direction to fail in and a bad thing to do silently, because the day an app points at a model
 * newer than the table, the limits that exist to stop a runaway loop stop, and the spend panel
 * reads $0.00, with nothing anywhere saying so.
 *
 * @param model - The model about to be called.
 * @param limits - The configured ceilings; they decide what the warning says is lost.
 */
export function warnIfUnpriced(model: string, limits: AiLimitsConfigShape): void {
  if (modelPrice(model) || _warnedUnpriced.has(model)) return;
  _warnedUnpriced.add(model);

  const ceilings = limits.perRequestUsd > 0 || limits.perDayUsd > 0;
  frameworkLog("ai").warn(
    (ceilings
      ? `${model} has no price, so the spend ceilings (limits.perRequestUsd, limits.perDayUsd) do not apply to it and its spend is recorded as $0. `
      : `${model} has no price, so its spend is recorded as $0. `) +
      `Add one with registerModelPrice("${model}", { input, output }), USD per million tokens.`,
    { model },
  );
}

/** @internal Forget which models were warned about; backs this package's own tests. */
export function _resetUnpricedWarnings(): void {
  _warnedUnpriced.clear();
}

/** Today's spend, keyed by UTC date so the window rolls without a timer. */
let _day = "";
let _spentUsd = 0;

/** UTC `YYYY-MM-DD`. UTC, not local, so a deploy across zones agrees with itself. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function roll(): void {
  const now = today();
  if (now !== _day) {
    _day = now;
    _spentUsd = 0;
  }
}

/** USD recorded so far today, in this process. */
export function spentToday(): number {
  roll();
  return _spentUsd;
}

/** Add a completed request's cost to today's total. */
export function recordSpend(model: string, usage: AiUsage): number {
  roll();
  const cost = estimateCost(model, usage);
  _spentUsd += cost;
  return cost;
}

/**
 * Reset the ledger.
 *
 * @internal Backs `ai:spend --reset` and this package's own tests. An app's test
 * wanting spend isolation should reach for `AiFake`, which is the seam built for
 * it; this one reaches past the manager into module state.
 */
export function resetSpend(): void {
  _day = today();
  _spentUsd = 0;
}

/**
 * Refuse a request that would breach a ceiling.
 *
 * @param model - The model about to be called.
 * @param estimatedInputTokens - Counted, not guessed, where the driver can.
 * @param maxOutputTokens - The request's own ceiling; the worst case we can bound.
 *
 * @throws {AiSpendLimitError} when either ceiling would be breached.
 */
export function assertWithinLimits(
  limits: AiLimitsConfigShape,
  model: string,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): void {
  if (limits.perDayUsd > 0 && spentToday() >= limits.perDayUsd) {
    throw new AiSpendLimitError(
      `Daily AI spend ceiling reached: $${spentToday().toFixed(2)} of $${limits.perDayUsd.toFixed(2)}. ` +
        `Raise limits.perDayUsd in config/ai.ts, or wait for the UTC day to roll.`,
      { model, spentUsd: spentToday(), limitUsd: limits.perDayUsd },
    );
  }

  if (limits.perRequestUsd <= 0) return;
  // Unpriced model: the ceiling has nothing to compare against, so it stands
  // aside rather than blocking every request to a model we simply don't know.
  if (!modelPrice(model)) return;

  const worstCase = estimateCost(model, {
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });

  if (worstCase > limits.perRequestUsd) {
    // The price is named because the table is a thing that can be wrong, and when
    // it is, this refusal is the only symptom. A row carrying its predecessor's
    // number once made the ceiling reject requests comfortably inside a budget, and
    // the message said "spend limit" — which sends someone to their config rather
    // than to the row that is 50% high. Quoting the rate makes a bad table legible
    // from the error, and `registerModelPrice` is how it gets corrected without
    // waiting for a release.
    const price = modelPrice(model)!;
    throw new AiSpendLimitError(
      `This request could cost up to $${worstCase.toFixed(4)}, over the per-request ceiling of ` +
        `$${limits.perRequestUsd.toFixed(4)}. Shorten the prompt, lower maxTokens, or raise ` +
        `limits.perRequestUsd in config/ai.ts. ` +
        `Priced at $${price.input}/$${price.output} per million tokens for ${model} — if that is ` +
        `not what you are billed, correct it with registerModelPrice() rather than raising the ceiling.`,
      {
        model,
        estimatedInputTokens,
        maxOutputTokens,
        worstCaseUsd: worstCase,
        priceUsdPerMillion: price,
      },
    );
  }
}
