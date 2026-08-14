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
import { AiSpendLimitError } from "./errors.ts";
import { estimateCost, modelPrice } from "./pricing.ts";
import type { AiLimitsConfigShape, AiUsage } from "./types.ts";

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

/** Reset the ledger. Tests, and the `ai:spend --reset` path. */
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
    throw new AiSpendLimitError(
      `This request could cost up to $${worstCase.toFixed(4)}, over the per-request ceiling of ` +
        `$${limits.perRequestUsd.toFixed(4)}. Shorten the prompt, lower maxTokens, or raise ` +
        `limits.perRequestUsd in config/ai.ts.`,
      { model, estimatedInputTokens, maxOutputTokens, worstCaseUsd: worstCase },
    );
  }
}
