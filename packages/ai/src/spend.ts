/**
 * Spend ceilings and the running spend ledger.
 *
 * Two guards, both cheap, both approximate on purpose:
 *
 * - **Per-request** is checked *before* the call, from a token estimate, because
 *   after the call the money is already spent. It bounds the blast radius of one
 *   runaway prompt.
 * - **Per-day** is checked from actual reported usage. It is counted in this
 *   process, and also in the cache of the app when that is shared (SQLite on a
 *   file, Redis), so the web server, the worker and a restart all spend from
 *   one ceiling. The cache refines the count and never gates the request: if
 *   it cannot be reached, the spend of this process still counts and the
 *   ceiling fails open to that, rather than refusing every request.
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

/**
 * The slice of the cache the shared daily ledger needs. Structural: `@zerotal/ai` does not
 * depend on `@zerotal/cache`, and anything with these two methods will do.
 */
export interface SharedSpendStore {
  get<T>(key: string): Promise<T | null>;
  increment(key: string, by: number, ttl?: number): Promise<number>;
}

/** Money is kept as whole micro-dollars in the store, so a float never drifts across additions. */
const MICROS = 1_000_000;
/** Two days, so a ledger outlives the UTC day it covers by a margin for clock skew. */
const LEDGER_TTL_SECONDS = 172_800;

let _shared: SharedSpendStore | undefined;
/** The shared total as last seen, in micro-dollars: every process, this one included. */
let _sharedMicros = 0;
let _warnedSharedFailure = false;

const ledgerKey = (day: string): string => `ai:spend:${day}`;

/** UTC `YYYY-MM-DD`. UTC, not local, so a deploy across zones agrees with itself. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function roll(): void {
  const now = today();
  if (now !== _day) {
    _day = now;
    _spentUsd = 0;
    _sharedMicros = 0;
  }
}

/**
 * Count the daily spend in `store` as well as in this process. The provider calls this when the
 * app has a cache that other processes can see; pass `undefined` to go back to per process.
 */
export function useSharedSpend(store: SharedSpendStore | undefined): void {
  _shared = store;
  _sharedMicros = 0;
  _warnedSharedFailure = false;
}

/** Whether the daily spend is being counted in a shared store. */
export function isSpendShared(): boolean {
  return _shared !== undefined;
}

function warnSharedFailure(): void {
  if (_warnedSharedFailure) return;
  _warnedSharedFailure = true;
  frameworkLog("ai").warn(
    "The shared AI spend ledger cannot be reached, so the daily ceiling is counting this process only.",
  );
}

/**
 * Pull the shared total, so the ceiling is checked against what every process has spent.
 * A cache that cannot be reached leaves the last figure standing: the spend of this process is
 * still counted, and a ceiling that fails open on an outage is the lesser harm on a request path.
 */
export async function refreshSharedSpend(): Promise<void> {
  if (!_shared) return;
  roll();
  const day = _day;
  try {
    const total = (await _shared.get<number>(ledgerKey(day))) ?? 0;
    if (day === _day) _sharedMicros = total;
  } catch {
    warnSharedFailure();
  }
}

/**
 * USD recorded so far today. The spend of this process, or, when a shared ledger is in use, the
 * larger of that and the shared total as last seen. The shared total already includes this
 * process once it has been written, so the two are compared and never added.
 */
export function spentToday(): number {
  roll();
  return Math.max(_spentUsd, _sharedMicros / MICROS);
}

/** Add a completed request to the total of today. */
export function recordSpend(model: string, usage: AiUsage): number {
  roll();
  const cost = estimateCost(model, usage);
  _spentUsd += cost;

  // Written without waiting: the request has been answered and this is bookkeeping. The total the
  // store returns covers every process, so it is also the freshest view of the others.
  if (_shared && cost > 0) {
    const day = _day;
    _shared
      .increment(ledgerKey(day), Math.round(cost * MICROS), LEDGER_TTL_SECONDS)
      .then((total) => {
        if (day === _day && total > _sharedMicros) _sharedMicros = total;
      })
      .catch(warnSharedFailure);
  }
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
  _sharedMicros = 0;
  _warnedSharedFailure = false;
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
