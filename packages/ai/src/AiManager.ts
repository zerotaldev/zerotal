import { FrameworkEvents } from "@zerotal/core";
import { runAgentLoop } from "./agentLoop.ts";
import { AnthropicDriver } from "./drivers/AnthropicDriver.ts";
import { OllamaDriver } from "./drivers/OllamaDriver.ts";
import { OpenAiDriver } from "./drivers/OpenAiDriver.ts";
import { OllamaEmbeddingsDriver } from "./drivers/embeddings/OllamaEmbeddingsDriver.ts";
import { OpenAiEmbeddingsDriver } from "./drivers/embeddings/OpenAiEmbeddingsDriver.ts";
import type { EmbeddingsDriver } from "./drivers/embeddings/EmbeddingsDriver.ts";
import type { AiDriver, DriverStatus } from "./drivers/AiDriver.ts";
import { normalizeMessages, promptText } from "./drivers/AiDriver.ts";
import { AiCancelledError, AiConfigError, AiRefusedError, UnknownAiDriverError } from "./errors.ts";
import { AiGenerated, AiRefused } from "./events.ts";
import { estimateCost } from "./pricing.ts";
import { redactPrompt } from "./redact.ts";
import { _resolveSchema, type SchemaInput } from "./schema.ts";
import { assertWithinLimits, recordSpend } from "./spend.ts";
import type {
  AiAgentResult,
  AiConfigShape,
  AiEmbedRequest,
  AiEmbedResponse,
  AiRequest,
  AiResponse,
  AiStreamChunk,
  AiUsage,
} from "./types.ts";

/** A generation driver factory, resolved once on first use. */
type DriverResolver = () => AiDriver;
/** An embeddings driver factory, resolved once on first use. */
type EmbeddingsResolver = () => EmbeddingsDriver;

/** An agent run, plus the two things only the caller can decide. */
export interface AiAgentRequest extends AiRequest {
  /**
   * Name this run to hold a lock for its duration.
   *
   * Opt-in and *named*, because a lock is only meaningful when it identifies the
   * work: `lock: "triage:invoice-4821"` stops two workers triaging the same
   * invoice, while a shared key would serialize every agent run in the app.
   *
   * The lock refreshes while the loop runs — a multi-minute turn is exactly the
   * process a fixed TTL cannot size for — and the loop's signal is aborted if it
   * is ever lost, because at that point another holder may be doing the same work.
   */
  lock?: string;
  /** Override `agent.maxSteps` for this run. */
  maxSteps?: number;
  /** Override `agent.maxResumes` for this run. */
  maxResumes?: number;
}

/** What `Ai.queue()` needs beyond the request. */
export interface AiQueueOptions {
  /** The handler name registered with {@link AiManager.onGenerated}. */
  handler: string;
  /** Anything the handler needs to know — an id, a tenant. Must be JSON-safe. */
  meta?: Record<string, unknown> | undefined;
  /** Queue name. Defaults to `ai`. */
  queue?: string | undefined;
}

/** What a queued generation's handler receives. */
export type AiQueueHandler = (
  response: AiResponse,
  meta: Record<string, unknown>,
) => Promise<void> | void;

/** Handlers for queued generations, by name. Module-level so the worker finds them. */
const _handlers = new Map<string, AiQueueHandler>();

/**
 * The AI manager: one surface over every configured provider.
 *
 * Everything that is *not* provider-specific lives here rather than in the
 * drivers — spend ceilings, prompt redaction, telemetry, the agent lock — so a
 * new driver is a translation layer and nothing more. That is the difference
 * between an abstraction and a pile of clients.
 */
export class AiManager {
  private readonly _resolvers = new Map<string, DriverResolver>();
  private readonly _drivers = new Map<string, AiDriver>();
  private readonly _embeddingResolvers = new Map<string, EmbeddingsResolver>();
  private readonly _embeddings = new Map<string, EmbeddingsDriver>();

  constructor(readonly config: AiConfigShape) {
    const { drivers, embeddings } = config;

    if (drivers.anthropic) {
      const cfg = drivers.anthropic;
      this._resolvers.set("anthropic", () => new AnthropicDriver(cfg));
    }
    if (drivers.openai) {
      const cfg = drivers.openai;
      this._resolvers.set("openai", () => new OpenAiDriver(cfg));
    }
    if (drivers.ollama) {
      const cfg = drivers.ollama;
      this._resolvers.set("ollama", () => new OllamaDriver(cfg));
    }

    if (embeddings.drivers.openai) {
      const cfg = embeddings.drivers.openai;
      this._embeddingResolvers.set("openai", () => new OpenAiEmbeddingsDriver(cfg));
    }
    if (embeddings.drivers.ollama) {
      const cfg = embeddings.drivers.ollama;
      this._embeddingResolvers.set("ollama", () => new OllamaEmbeddingsDriver(cfg));
    }
  }

  // ── Drivers ──────────────────────────────────────────────────────────────

  /** Every configured generation driver name. */
  drivers(): string[] {
    return [...this._resolvers.keys()];
  }

  /**
   * Register a custom provider, or replace a built-in one.
   *
   * @example
   * // in a service provider's onBooted()
   * const ai = app.container.makeSync("ai");
   * ai.extend("bedrock", () => new BedrockDriver(config));
   */
  extend(name: string, factory: DriverResolver): this {
    this._resolvers.set(name, factory);
    this._drivers.delete(name);
    return this;
  }

  /** Register a custom embeddings provider. */
  extendEmbeddings(name: string, factory: EmbeddingsResolver): this {
    this._embeddingResolvers.set(name, factory);
    this._embeddings.delete(name);
    return this;
  }

  /** Resolve a generation driver, constructing it on first use. */
  driver(name?: string): AiDriver {
    const key = name ?? this.config.default;
    const existing = this._drivers.get(key);
    if (existing) return existing;

    const resolver = this._resolvers.get(key);
    if (!resolver) throw new UnknownAiDriverError(key, [...this._resolvers.keys()]);

    const instance = resolver();
    this._drivers.set(key, instance);
    return instance;
  }

  /** Resolve an embeddings driver, constructing it on first use. */
  embeddingsDriver(name?: string): EmbeddingsDriver {
    const key = name ?? this.config.embeddings.default;
    const existing = this._embeddings.get(key);
    if (existing) return existing;

    const resolver = this._embeddingResolvers.get(key);
    if (!resolver) {
      throw new AiConfigError(
        `No embeddings driver '${key}' is configured. Anthropic has no embeddings endpoint, so ` +
          `embeddings need their own block: embeddings: { default: 'openai', drivers: { openai: … } }.`,
        { driver: key, configured: [...this._embeddingResolvers.keys()] },
      );
    }

    const instance = resolver();
    this._embeddings.set(key, instance);
    return instance;
  }

  // ── Generation ───────────────────────────────────────────────────────────

  /**
   * Generate text and return just the text.
   *
   * @example
   * const summary = await Ai.text(`Summarize in one sentence:\n\n${article}`);
   */
  async text(request: AiRequest | string): Promise<string> {
    return (await this.generate(request)).text;
  }

  /**
   * Generate text and return the full response — usage, stop reason, tool calls.
   *
   * @example
   * const response = await Ai.generate({ prompt, effort: "low" });
   * metrics.increment("ai.tokens", response.usage.outputTokens);
   */
  async generate(request: AiRequest | string): Promise<AiResponse> {
    const normalized = normalize(request);
    const driver = this.driver(normalized.driver);

    return this._observe("text", driver, normalized, async () => {
      await this._guardSpend(driver, normalized);
      return driver.text(normalized);
    });
  }

  /**
   * Stream a generation, token by token.
   *
   * The final chunk is always `{ type: "done" }`, carrying the assembled
   * response — so a caller that only wants the tokens can ignore it, and one
   * that needs usage does not have to add up the pieces itself.
   *
   * @example
   * for await (const chunk of Ai.stream({ prompt, signal: this.signal })) {
   *   if (chunk.type === "text") this.answer += chunk.text;
   * }
   */
  async *stream(request: AiRequest | string): AsyncIterable<AiStreamChunk> {
    const normalized = normalize(request);
    const driver = this.driver(normalized.driver);
    const startedAt = performance.now();
    let recorded = false;

    try {
      await this._guardSpend(driver, normalized);

      for await (const chunk of driver.stream(normalized)) {
        if (chunk.type === "done") {
          recorded = true;
          this._record("stream", driver, normalized, chunk.response, startedAt);
        }
        yield chunk;
      }
    } catch (error) {
      recorded = true;
      this._recordFailure("stream", driver, normalized, error, startedAt);
      throw error;
    } finally {
      // A consumer that `break`s out — a cancelled Flow task, a closed tab —
      // never sees the done chunk, and the tokens generated so far were still
      // paid for. Recording it here is the difference between "cancelled
      // streams are cheap" being true and merely being invisible.
      if (!recorded) {
        this._recordFailure("stream", driver, normalized, new AiCancelledError(), startedAt);
      }
    }
  }

  /**
   * Generate a value that satisfies a validator schema.
   *
   * Constraints structured output cannot express (`min`, `regex`, …) are
   * stripped from the schema sent to the provider and re-checked here, against
   * the same schema — see `schema.ts` for why that is the deal.
   *
   * @example
   * const review = await Ai.object(
   *   { prompt: `Classify this review:\n\n${text}` },
   *   (rule) => ({
   *     sentiment: rule.string().in(["positive", "neutral", "negative"]),
   *     summary:   rule.string().max(140),
   *     score:     rule.number().min(1).max(5),
   *   }),
   * );
   */
  async object<T = Record<string, unknown>>(
    request: AiRequest | string,
    schema: SchemaInput | ((rule: import("@zerotal/validator").RuleBuilder) => SchemaInput),
  ): Promise<T> {
    const normalized = normalize(request);
    const driver = this.driver(normalized.driver);
    const resolved = await _resolveSchema(schema);
    const startedAt = performance.now();

    try {
      await this._guardSpend(driver, normalized);
      const result = await driver.object<T>(normalized, resolved);
      this._record(
        "object",
        driver,
        normalized,
        { model: result.model, usage: result.usage },
        startedAt,
      );
      return result.object;
    } catch (error) {
      this._recordFailure("object", driver, normalized, error, startedAt);
      throw error;
    }
  }

  /**
   * Run the tool-calling loop until the model stops asking for tools.
   *
   * Pass `lock` to make the run exclusive for its own name; the lock refreshes
   * for as long as the loop runs, and the loop stops if it is ever lost.
   *
   * @example
   * const result = await Ai.agent({
   *   prompt: "Refund order 4821 if it shipped over 30 days ago.",
   *   tools: [lookupOrder, issueRefund],
   *   lock: "refund:4821",
   * });
   */
  async agent(request: AiAgentRequest): Promise<AiAgentResult> {
    const driver = this.driver(request.driver);
    const startedAt = performance.now();

    const options = {
      maxSteps: request.maxSteps ?? this.config.agent.maxSteps,
      maxResumes: request.maxResumes ?? this.config.agent.maxResumes,
      signal: request.signal ?? new AbortController().signal,
    };

    const run = async (signal: AbortSignal): Promise<AiAgentResult> => {
      await this._guardSpend(driver, request);
      const loop = driver.agent ?? ((r, o) => runAgentLoop(driver, r, o));
      return loop(request, { ...options, signal });
    };

    try {
      const result = await this._withLock(request, options.signal, run);
      this._record("agent", driver, request, result, startedAt);
      return result;
    } catch (error) {
      this._recordFailure("agent", driver, request, error, startedAt);
      throw error;
    }
  }

  /**
   * Embed text into vectors.
   *
   * @example
   * const { embeddings } = await Ai.embed(["first chunk", "second chunk"]);
   */
  async embed(
    input: string | string[],
    options: Omit<AiEmbedRequest, "input"> = {},
  ): Promise<AiEmbedResponse> {
    const driver = this.embeddingsDriver(options.driver);
    const startedAt = performance.now();

    const result = await driver.embed({ input, ...options });

    FrameworkEvents.emit(
      new AiGenerated(
        driver.name,
        result.model,
        "embed",
        result.usage.inputTokens,
        0,
        0,
        performance.now() - startedAt,
        0,
        true,
        `${Array.isArray(input) ? input.length : 1} input(s)`,
      ),
    );

    return result;
  }

  /** Count the prompt's tokens with the provider's own tokenizer. */
  async countTokens(request: AiRequest | string): Promise<number> {
    const normalized = normalize(request);
    return this.driver(normalized.driver).countTokens(normalized);
  }

  /** Reach a provider once and report what came back. Backs `zt ai:test`. */
  async verify(name?: string): Promise<DriverStatus> {
    return this.driver(name).verify();
  }

  // ── Queued generations ───────────────────────────────────────────────────

  /**
   * Register a handler for queued generations.
   *
   * Named rather than passed inline because a queued job is serialized: a
   * closure cannot survive the trip to a worker process, but a name can.
   *
   * @example
   * Ai.onGenerated("summarize-ticket", async (response, meta) => {
   *   await Ticket.query().where("id", meta.ticketId).update({ summary: response.text });
   * });
   */
  onGenerated(name: string, handler: AiQueueHandler): this {
    _handlers.set(name, handler);
    return this;
  }

  /** The handler registered under `name`, if any. @internal */
  handlerFor(name: string): AiQueueHandler | undefined {
    return _handlers.get(name);
  }

  /**
   * Run a generation in the background, then call a registered handler.
   *
   * @example
   * await Ai.queue({ prompt }, { handler: "summarize-ticket", meta: { ticketId } });
   */
  async queue(request: AiRequest, options: AiQueueOptions): Promise<void> {
    if (!_handlers.has(options.handler)) {
      throw new AiConfigError(
        `No queued-generation handler named '${options.handler}'. Register one with ` +
          `Ai.onGenerated("${options.handler}", …) — in a service provider, so the worker ` +
          `process registers it too.`,
        { handler: options.handler, registered: [..._handlers.keys()] },
      );
    }

    const { AiGenerationJob } = await import("./AiGenerationJob.ts");
    const { Queue } = await import("@zerotal/queue");
    await Queue.dispatch(new AiGenerationJob(request, options));
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Hold the run's lock, if it named one, refreshing it throughout.
   *
   * Locking is skipped silently when `LockProvider` is not registered — an app
   * that never configured locks should not have its agent calls fail on a
   * dependency it did not ask for.
   */
  private async _withLock<T>(
    request: AiAgentRequest,
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!request.lock || !this.config.agent.lock) return run(signal);

    const manager = await lockManager();
    if (!manager) return run(signal);

    return manager.try(
      `ai:agent:${request.lock}`,
      this.config.agent.lockTtl,
      // Two signals, one abort: the caller's cancellation and the lost-lock
      // signal both have to stop the loop, and only one can be passed down.
      (_lock, lostSignal) => run(anySignal([signal, lostSignal])),
      { refresh: true },
    );
  }

  /**
   * Refuse a request that would breach a ceiling, before it is sent.
   *
   * The token count costs a round trip, so it is only taken when a per-request
   * ceiling actually exists; with only a daily ceiling configured the check is
   * free. A driver with no counting endpoint reports 0 and gets a labelled
   * character approximation — good enough to bound spend, never used for billing.
   */
  private async _guardSpend(driver: AiDriver, request: AiRequest): Promise<void> {
    const { limits } = this.config;
    if (limits.perRequestUsd <= 0 && limits.perDayUsd <= 0) return;

    const model = request.model ?? driver.model;
    let inputTokens = 0;

    if (limits.perRequestUsd > 0) {
      inputTokens = await driver.countTokens(request).catch(() => 0);
      if (inputTokens === 0) inputTokens = approximateTokens(request);
    }

    const maxTokens = request.maxTokens ?? this.config.drivers.anthropic?.maxTokens ?? 16000;
    assertWithinLimits(limits, model, inputTokens, maxTokens);
  }

  /** Run one operation, recording success or failure exactly once. */
  private async _observe<T extends { model: string; usage: AiUsage }>(
    operation: string,
    driver: AiDriver,
    request: AiRequest,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await fn();
      this._record(operation, driver, request, result, startedAt);
      return result;
    } catch (error) {
      this._recordFailure(operation, driver, request, error, startedAt);
      throw error;
    }
  }

  private _record(
    operation: string,
    driver: AiDriver,
    request: AiRequest,
    result: { model: string; usage: AiUsage },
    startedAt: number,
  ): void {
    const cost = recordSpend(result.model, result.usage);
    FrameworkEvents.emit(
      new AiGenerated(
        driver.name,
        result.model,
        operation,
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.cacheReadTokens,
        performance.now() - startedAt,
        cost,
        true,
        this._preview(request),
      ),
    );
  }

  private _recordFailure(
    operation: string,
    driver: AiDriver,
    request: AiRequest,
    error: unknown,
    startedAt: number,
  ): void {
    const model = request.model ?? driver.model;
    const preview = this._preview(request);

    if (error instanceof AiRefusedError) {
      FrameworkEvents.emit(new AiRefused(driver.name, model, error.category, preview));
    }

    FrameworkEvents.emit(
      new AiGenerated(
        driver.name,
        model,
        operation,
        0,
        0,
        0,
        performance.now() - startedAt,
        0,
        false,
        preview,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  /** The telemetry label for a request — redacted unless the app opted out. */
  private _preview(request: AiRequest): string {
    return redactPrompt(promptText(request), this.config.redact);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A bare string is the common case; keep it a one-liner at every call site. */
function normalize(request: AiRequest | string): AiRequest {
  return typeof request === "string" ? { prompt: request } : request;
}

/** Accept either a schema map or a `(rule) => schema` factory. */
/** The `lock` binding, or `undefined` when the app has no LockProvider. */
async function lockManager(): Promise<import("@zerotal/core/lock").LockManager | undefined> {
  try {
    const { currentApp } = await import("@zerotal/core");
    return currentApp().container.tryMake("lock");
  } catch {
    return undefined;
  }
}

/**
 * One signal that aborts when any of its inputs does.
 *
 * `AbortSignal.any` covers this in current runtimes; the manual fallback keeps
 * a lost lock able to stop the loop on anything older.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * A rough token count for drivers with no counting endpoint.
 *
 * Four characters per token is the usual English approximation. It exists only
 * to give the per-request ceiling something to compare against — never for
 * billing, and never for a Claude model, where `countTokens` is exact.
 */
function approximateTokens(request: AiRequest): number {
  let characters = request.system?.length ?? 0;
  for (const message of normalizeMessages(request)) characters += message.content.length;
  return Math.ceil(characters / 4);
}

/** Re-exported so the monitor section can price a row without importing pricing. */
export { estimateCost };
