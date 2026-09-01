/**
 * The vocabulary every driver speaks.
 *
 * These types are deliberately provider-shaped only where every provider agrees.
 * Where they don't — thinking budgets, reasoning effort, cache breakpoints — the
 * difference goes through {@link AiRequest.providerOptions} rather than being
 * flattened into the intersection of what everyone supports.
 */

/** How hard the model should work before answering. Mapped per-driver. */
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Who said it. Tool results ride inside a `user` turn, as the providers expect. */
export type AiRole = "user" | "assistant";

/** A tool call the model asked for, lifted out of whatever block shape the provider used. */
export interface AiToolCall {
  /** Provider-assigned id — echo it back with the result so the pairing survives. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The answer to one {@link AiToolCall}. */
export interface AiToolResult {
  id: string;
  /** Serialized output. Objects are JSON-stringified before they reach here. */
  content: string;
  isError?: boolean;
}

/** One turn of a conversation. */
export interface AiMessage {
  role: AiRole;
  content: string;
  /** Tool calls this assistant turn asked for. */
  toolCalls?: AiToolCall[];
  /** Tool results this user turn carries back. */
  toolResults?: AiToolResult[];
  /**
   * Mark this turn as a prompt-cache breakpoint.
   *
   * Everything *before and including* it is cached, so the marker goes on the last
   * message of the stable prefix — a long document, a retrieved corpus, a fixed
   * few-shot block — and everything after it stays uncached.
   *
   * The system prompt is cached separately by `cacheSystem` and does not consume a
   * breakpoint. Anthropic allows four in total, and marking a fifth is an error
   * from the provider rather than a silently dropped marker, so the framework
   * refuses past the limit with a message naming which turns asked.
   *
   * Only worth setting on a prefix that is genuinely stable and genuinely large:
   * a cache write costs more than an ordinary input token, so caching something
   * that changes every request is strictly more expensive than not caching it.
   */
  cache?: boolean;
  /**
   * The provider's own content blocks for this turn, kept verbatim.
   *
   * Replaying a turn that contained thinking, cache markers, or server-tool blocks
   * requires handing the provider back exactly what it produced — a reconstruction
   * from `content` alone loses the signature and the request is rejected. Drivers
   * write this; callers should not.
   */
  raw?: unknown;
}

/** Token accounting for one request. Fields a provider does not report stay 0. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache (billed at a fraction of input). */
  cacheReadTokens: number;
  /** Tokens written to the prompt cache (billed at a premium over input). */
  cacheWriteTokens: number;
  /**
   * Of {@link cacheWriteTokens}, those written to a **1-hour** cache.
   *
   * Anthropic prices a 5-minute cache write at 1.25x input and a 1-hour write at
   * 2x, and reports the split only when a 1-hour cache was actually asked for.
   * Kept separate because one number cannot be priced two ways: an estimator
   * given only the total has to guess, and guessing low on a spend ceiling lets
   * spend through rather than blocking it.
   *
   * Zerotal's own driver never requests a 1-hour cache, so this is absent or `0`
   * unless an app reaches past it with `providerOptions`. Counted inside
   * `cacheWriteTokens`, not alongside it.
   *
   * Optional rather than required, because a custom `AiDriver` constructs this
   * type — making it required would have broken every one of them for an
   * accounting detail their provider probably does not report.
   */
  cacheWrite1hTokens?: number | undefined;
}

/** Why generation stopped. `refusal` is a successful HTTP response, not an error. */
export type AiStopReason =
  "end_turn" | "max_tokens" | "tool_use" | "pause_turn" | "refusal" | "stop_sequence" | "unknown";

/**
 * Per-driver escape hatch, keyed by driver name and passed through untouched.
 *
 * @example
 * providerOptions: {
 *   anthropic: { thinking: { type: "adaptive", display: "summarized" } },
 *   openai: { reasoning: { effort: "high" } },
 * }
 */
export type AiProviderOptions = Record<string, Record<string, unknown>>;

/** What every generation call takes. `prompt` and `messages` are interchangeable. */
export interface AiRequest {
  /** Shorthand for a single user turn. Ignored when `messages` is present. */
  prompt?: string;
  messages?: AiMessage[];
  /** The system prompt. Cached by default on drivers that support it. */
  system?: string;
  /** Override the driver's configured model for this call. */
  model?: string;
  maxTokens?: number;
  effort?: AiEffort;
  /** Tools the model may call. Only `agent()` runs them; `text()` reports them. */
  tools?: AiTool[];
  /** Cancels the HTTP request and, for `agent()`, ends the loop between steps. */
  signal?: AbortSignal;
  providerOptions?: AiProviderOptions;
  /** Turn off prompt caching of the system prompt for this call. */
  cache?: boolean;
  /**
   * Sampling temperature — **best-effort, not honoured everywhere.**
   *
   * Current Claude models reject `temperature` with a 400, so the Anthropic
   * driver drops it rather than failing every request. Reach for
   * {@link AiRequest.effort} instead: `low` for terse and deterministic-ish,
   * `max` when correctness matters more than cost.
   */
  temperature?: number;
  /** Which configured driver to use. Defaults to `ai.default`. */
  driver?: string;
}

/** A finished, non-streaming generation. */
export interface AiResponse {
  text: string;
  /** The model that actually served the request — a fallback may have swapped it. */
  model: string;
  usage: AiUsage;
  stopReason: AiStopReason;
  /** Tool calls the model asked for. Empty unless `tools` were supplied. */
  toolCalls: AiToolCall[];
  /**
   * This turn, in the form to append when continuing the conversation.
   *
   * The driver builds it because only the driver knows what has to survive
   * verbatim: an assistant turn carrying thinking or cache blocks is rejected
   * when it is rebuilt from `text`, since the signature does not round-trip.
   * The agent loop appends this rather than reconstructing one.
   */
  assistantTurn: AiMessage;
  /** The provider's untouched response object, for anything this shape omits. */
  raw?: unknown;
}

/** One event from a streaming generation. */
export type AiStreamChunk =
  | { type: "text"; text: string }
  /** Summarized reasoning, on drivers configured to return it. */
  | { type: "thinking"; text: string }
  | { type: "tool_call"; call: AiToolCall }
  | { type: "done"; response: AiResponse };

/** A structured-output generation: the parsed value plus the usual accounting. */
export interface AiObjectResponse<T> {
  object: T;
  model: string;
  usage: AiUsage;
  raw?: unknown;
}

/** A tool the model can call, with a handler this package will run. */
export interface AiTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema for the input, already translated from a validator schema. */
  inputSchema: JsonSchema;
  /**
   * Runs when the model calls the tool. Return anything JSON-serializable; a
   * string is passed through, everything else is stringified.
   */
  handler: (input: I, ctx: AiToolContext) => Promise<unknown> | unknown;
}

/** What a tool handler is told about the turn that invoked it. */
export interface AiToolContext {
  /** Aborted when the caller cancels, or when the agent loop's lock is lost. */
  signal: AbortSignal;
  /** 1-based index of the agent step that made this call. */
  step: number;
}

/** The result of running the agent loop to completion. */
export interface AiAgentResult {
  text: string;
  model: string;
  /** Summed across every step of the loop. */
  usage: AiUsage;
  /** Every tool call made, in order, with what the handler returned. */
  steps: AiAgentStep[];
  stopReason: AiStopReason;
}

/** One tool call and its result within an agent run. */
export interface AiAgentStep {
  step: number;
  call: AiToolCall;
  result: string;
  isError: boolean;
  durationMs: number;
}

/** A vector embedding request. */
export interface AiEmbedRequest {
  input: string | string[];
  model?: string;
  driver?: string;
  signal?: AbortSignal;
}

/** Embeddings, one vector per input, in input order. */
export interface AiEmbedResponse {
  embeddings: number[][];
  model: string;
  usage: Pick<AiUsage, "inputTokens">;
}

// ── JSON Schema ────────────────────────────────────────────────────────────

/**
 * The narrow JSON Schema subset the structured-output APIs accept.
 *
 * Deliberately not the full spec: `minLength`, `maximum`, and friends are
 * rejected at request time by the providers, so {@link translateSchema} either
 * strips them (re-checking client-side) or refuses to emit them.
 */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  enum?: Array<string | number>;
  format?: string;
  /** Present only on nullable fields: `[{...}, {"type":"null"}]`. */
  anyOf?: JsonSchema[];
}

// ── Configuration ──────────────────────────────────────────────────────────

/** Anthropic driver settings. */
export interface AnthropicConfigShape {
  apiKey: string;
  /** Exact model id, no date suffix. */
  model: string;
  /** Cap for non-streaming calls. Covers thinking *and* response text. */
  maxTokens: number;
  /** Cap for streaming calls, where HTTP timeouts are not a concern. */
  streamMaxTokens: number;
  effort: AiEffort;
  /**
   * Whether a streamed `thinking` chunk carries text.
   *
   * The API defaults this to `"omitted"` on the current generation, which is why
   * the documented `thinking` stream chunk used to fire forever with `text: ""` —
   * thinking happened, and was billed, and nothing was emitted. It defaulted to
   * `"summarized"` on the 4.6 models, so a "thinking…" view built against those
   * worked and then silently stopped working as people moved forward.
   *
   * Defaults to `"summarized"` here, because a documented channel that is always
   * empty is worse than one that costs a little to fill. Set `"omitted"` to get
   * the API's own default back — the thinking still happens either way.
   */
  thinkingDisplay: "summarized" | "omitted";
  /** Route a safety refusal to Anthropic's recommended fallback model. */
  fallbacks: boolean;
  /** Mark the system prompt cacheable. The cheapest win available. */
  cacheSystem: boolean;
  /** Override the API base URL (proxies, gateways). */
  baseUrl?: string | undefined;
  /** Request timeout in milliseconds. */
  timeout: number;
  /**
   * Best-effort default sampling temperature. Dropped by this driver on models
   * that reject it (which is every current one) — `validateAiConfig` warns.
   */
  temperature?: number | undefined;
}

/** OpenAI driver settings. */
export interface OpenAiConfigShape {
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl: string;
  timeout: number;
}

/** Ollama driver settings — a local server, so no key. */
export interface OllamaConfigShape {
  model: string;
  baseUrl: string;
  timeout: number;
}

/**
 * Embeddings are their own block with their own driver.
 *
 * Anthropic has no embeddings endpoint, so tying embeddings to the generation
 * driver would make "Claude for generation, something cheaper for vectors" —
 * the normal pairing — impossible to express.
 */
export interface EmbeddingsConfigShape {
  default: string;
  drivers: {
    openai?: { apiKey: string; model: string; baseUrl: string; timeout: number };
    ollama?: { model: string; baseUrl: string; timeout: number };
  };
}

/** Spend ceilings, enforced before the request leaves. */
export interface AiLimitsConfigShape {
  /** Reject a single request whose estimated cost exceeds this, in USD. 0 = off. */
  perRequestUsd: number;
  /** Reject once the process has spent this much today, in USD. 0 = off. */
  perDayUsd: number;
}

/** How the agent loop behaves. */
export interface AiAgentConfigShape {
  /** Hold a refreshable lock for the duration of a named agent run. */
  lock: boolean;
  /** Lock TTL in seconds — how long after a crash before another run may start. */
  lockTtl: number;
  /** Maximum tool-calling round trips before the loop gives up. */
  maxSteps: number;
  /** Maximum `pause_turn` resumes before the loop gives up. */
  maxResumes: number;
}

/** The full `config/ai.ts` shape. */
export interface AiConfigShape {
  default: string;
  drivers: {
    anthropic?: AnthropicConfigShape;
    openai?: OpenAiConfigShape;
    ollama?: OllamaConfigShape;
  };
  embeddings: EmbeddingsConfigShape;
  limits: AiLimitsConfigShape;
  /**
   * Redact prompts before they reach logs and the monitor. A prompt is user data
   * and the observability path is the one place it would otherwise be kept.
   */
  redact: boolean;
  agent: AiAgentConfigShape;
}
