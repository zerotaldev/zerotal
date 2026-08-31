/**
 * What each Anthropic model will actually accept on a request.
 *
 * The driver used to send `output_config.effort` and `thinking: { type: "adaptive" }`
 * on every call, and decide sampling with one regex. That was right for the current
 * generation and wrong for everything older, in a way that had the package
 * contradicting itself: `claude-haiku-4-5` is in the pricing table — so the package
 * presents it as supported — and the driver could not successfully call it, because
 * `effort` is a 400 on that model and `adaptive` thinking is not a shape it takes.
 *
 * The two mistakes compounded. On Haiku 4.5 the driver dropped a `temperature` the
 * model accepts perfectly well, and told the user to reach for `effort` instead —
 * the one parameter guaranteed to fail there.
 *
 * ## Why the exceptions are listed and the default is current
 *
 * The obvious fix is an allowlist of models that behave the modern way, and it is the
 * wrong one: it needs an edit every time a model ships, and until that edit lands a
 * brand-new model is treated as legacy. Anthropic's direction of travel is *towards*
 * this shape, so the models that differ are a closed set that ages out rather than an
 * open one that grows.
 *
 * So: the older models are named, and anything unrecognised is assumed to behave like
 * the current generation. A new model works on the day it ships.
 *
 * @module
 */

/** What a model accepts on a request. */
export interface ModelCapabilities {
  /**
   * Accepts `temperature` / `top_p` / `top_k`.
   *
   * These became a 400 on the current generation; they are fine on 4.6 and below.
   */
  sampling: boolean;
  /**
   * Accepts `output_config.effort`.
   *
   * A 400 on the 4.5 generation, which has no equivalent knob.
   */
  effort: boolean;
  /**
   * How this model takes extended thinking.
   *
   * - `"adaptive"` — `{ type: "adaptive" }`, the model decides how much to spend.
   * - `"budget"` — `{ type: "enabled", budget_tokens: N }`, an explicit allowance.
   * - `null` — the model has no thinking mode and the field must be omitted.
   */
  thinking: "adaptive" | "budget" | null;
}

/**
 * The current generation's shape, and the default for anything unrecognised.
 *
 * A model this file has never heard of is far more likely to be newer than these
 * than older, because the older ones are already named below.
 */
const CURRENT: ModelCapabilities = { sampling: false, effort: true, thinking: "adaptive" };

/**
 * Models that differ from {@link CURRENT}, by exact id.
 *
 * A closed set: these age out of use, and nothing new joins them. That is the whole
 * reason the table is written as exceptions rather than as an allowlist.
 */
const EXCEPTIONS: Record<string, ModelCapabilities> = {
  // 4.6 was the last generation to accept sampling parameters. Effort and adaptive
  // thinking both work.
  "claude-opus-4-6": { sampling: true, effort: true, thinking: "adaptive" },
  "claude-sonnet-4-6": { sampling: true, effort: true, thinking: "adaptive" },

  // The 4.5 generation predates `output_config` entirely and wants an explicit
  // thinking budget. Sampling is fine.
  "claude-opus-4-5": { sampling: true, effort: false, thinking: "budget" },
  "claude-sonnet-4-5": { sampling: true, effort: false, thinking: "budget" },
  "claude-haiku-4-5": { sampling: true, effort: false, thinking: "budget" },
};

/**
 * What this model accepts.
 *
 * Non-Anthropic model ids are reported as accepting sampling and nothing
 * Anthropic-specific, because the Anthropic request shape is the only thing this
 * describes — an Ollama or OpenAI model reaches a different driver that builds its
 * own request.
 *
 * @param model - Exact model id, e.g. `claude-sonnet-5`.
 */
export function modelCapabilities(model: string): ModelCapabilities {
  if (!model.startsWith("claude-")) {
    return { sampling: true, effort: false, thinking: null };
  }
  return EXCEPTIONS[model] ?? CURRENT;
}

/**
 * Whether a model rejects `temperature` / `top_p` / `top_k` with a 400.
 *
 * @param model - Exact model id.
 * @returns `true` when sampling parameters must be dropped.
 */
export function modelRejectsSampling(model: string): boolean {
  return !modelCapabilities(model).sampling;
}
