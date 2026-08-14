import {
  AiCancelledError,
  AiDriverUnavailableError,
  AiRateLimitError,
  AiRefusedError,
  AiRequestError,
  AiSchemaError,
} from "../errors.ts";
import { recheckAgainstSchema, translateSchema, type SchemaInput } from "../schema.ts";
import { modelRejectsSampling } from "../pricing.ts";
import type {
  AiMessage,
  AiObjectResponse,
  AiRequest,
  AiResponse,
  AiStopReason,
  AiStreamChunk,
  AiTool,
  AiToolCall,
  AiUsage,
  AnthropicConfigShape,
} from "../types.ts";
import { normalizeMessages, type AiDriver, type DriverStatus } from "./AiDriver.ts";
import type {
  AnthropicBlock,
  AnthropicClient,
  AnthropicConstructor,
  AnthropicMessage,
  AnthropicMessagesApi,
  AnthropicModule,
  AnthropicUsage,
  LoadedAnthropic,
} from "./anthropic-sdk.ts";

/** Opts into the server-side refusal fallback. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Roughly the shortest system prompt worth a cache breakpoint.
 *
 * The minimum cacheable prefix is 512 tokens on Claude Opus 5 and 1024 on the
 * 4.x line, and a prefix below it silently does not cache — no error, just a
 * breakpoint that never pays. ~4 chars per token puts 1024 tokens near 4000
 * characters, so this is the conservative side of both thresholds.
 */
const CACHEABLE_SYSTEM_CHARS = 4000;

/**
 * The Anthropic driver.
 *
 * Several details here are load-bearing rather than stylistic, and each is
 * commented where it appears: sampling parameters are dropped (they 400),
 * `max_tokens` covers thinking *and* text, a refusal is a 200 that must be
 * checked before the content is read, and errors are mapped by SDK class.
 */
export class AnthropicDriver implements AiDriver {
  readonly name = "anthropic";

  private _loaded: LoadedAnthropic | undefined;
  private _loading: Promise<LoadedAnthropic> | undefined;
  private _warnedSampling = false;

  /**
   * @param config - The resolved `drivers.anthropic` block.
   * @param inject - A pre-built client, for tests. Nothing else supplies it.
   */
  constructor(
    private readonly config: AnthropicConfigShape,
    inject?: LoadedAnthropic,
  ) {
    this._loaded = inject;
  }

  get model(): string {
    return this.config.model;
  }

  // ── Generation ───────────────────────────────────────────────────────────

  async text(request: AiRequest): Promise<AiResponse> {
    const { client } = await this._load();
    const params = this._params(request, false);

    const message = await this._call(() =>
      this._api(client).create(params, this._options(request)),
    );

    return this._toResponse(message);
  }

  async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
    const { client } = await this._load();
    const params = this._params(request, true);

    const stream = this._api(client).stream(params, this._options(request));

    let partial = "";
    try {
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        const delta = (event as { delta: { type: string; text?: string; thinking?: string } })
          .delta;

        if (delta.type === "text_delta" && delta.text !== undefined) {
          partial += delta.text;
          yield { type: "text", text: delta.text };
        } else if (delta.type === "thinking_delta" && delta.thinking !== undefined) {
          yield { type: "thinking", text: delta.thinking };
        }
      }
    } catch (error) {
      throw this._mapError(error, request);
    }

    const final = await this._call(() => stream.finalMessage());

    // A mid-stream refusal has already handed the caller real text. Carrying it
    // on the error lets them discard a partial answer knowingly instead of
    // shipping a truncated one.
    this._assertNotRefused(final, partial);

    const response = this._toResponse(final);
    for (const call of response.toolCalls) yield { type: "tool_call", call };
    yield { type: "done", response };
  }

  async object<T>(request: AiRequest, schema: SchemaInput): Promise<AiObjectResponse<T>> {
    const { client } = await this._load();

    const params = this._params(request, false);
    const outputConfig = (params["output_config"] ?? {}) as Record<string, unknown>;
    params["output_config"] = {
      ...outputConfig,
      format: { type: "json_schema", schema: translateSchema(schema) },
    };
    // Structured output and tool use are separate constraints on the same turn;
    // asking for both makes the answer's shape ambiguous.
    delete params["tools"];

    const message = await this._call(() =>
      this._api(client).create(params, this._options(request)),
    );
    this._assertNotRefused(message);

    const text = textOf(message.content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiSchemaError(
        `The model's answer was constrained to a schema but did not parse as JSON. ` +
          `This usually means the response was truncated — check stop_reason ` +
          `(${message.stop_reason ?? "null"}) and raise maxTokens.`,
        { stopReason: message.stop_reason, text: text.slice(0, 200) },
      );
    }

    return {
      // Re-check here, not in the manager: the constraints stripped during
      // translation are only knowable next to the schema that lost them.
      object: recheckAgainstSchema<T>(schema, parsed),
      model: message.model,
      usage: toUsage(message.usage),
      raw: message,
    };
  }

  async countTokens(request: AiRequest): Promise<number> {
    const { client } = await this._load();
    const api = this._api(client);
    if (!api.countTokens) return 0;

    const params = this._params(request, false);
    // Counting is about the prompt; the response ceiling and sampling knobs are
    // not part of the question and some of them are rejected outright.
    delete params["max_tokens"];
    delete params["output_config"];
    delete params["fallbacks"];
    delete params["betas"];

    const result = await this._call(() => api.countTokens!(params, this._options(request)));
    return result.input_tokens;
  }

  async verify(): Promise<DriverStatus> {
    try {
      const response = await this.text({
        prompt: "Reply with the single word: ok",
        maxTokens: 64,
        effort: "low",
      });
      return {
        ok: true,
        model: response.model,
        detail: `${response.text.trim().slice(0, 60)} · ${response.usage.inputTokens} in / ${response.usage.outputTokens} out`,
      };
    } catch (error) {
      return {
        ok: false,
        model: this.config.model,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Request construction ─────────────────────────────────────────────────

  /** Whether this call goes through the beta namespace (it does iff fallbacks are on). */
  private _api(client: AnthropicClient): AnthropicMessagesApi {
    return this.config.fallbacks ? client.beta.messages : client.messages;
  }

  private _options(request: AiRequest): { signal?: AbortSignal; timeout: number } {
    // The SDK's timeout is in milliseconds, unlike the Python SDK's seconds.
    return request.signal
      ? { signal: request.signal, timeout: this.config.timeout }
      : { timeout: this.config.timeout };
  }

  private _params(request: AiRequest, streaming: boolean): Record<string, unknown> {
    const model = request.model ?? this.config.model;
    const maxTokens =
      request.maxTokens ?? (streaming ? this.config.streamMaxTokens : this.config.maxTokens);

    if (request.temperature !== undefined && modelRejectsSampling(model) && !this._warnedSampling) {
      this._warnedSampling = true;
      console.warn(
        `[Zerotal/ai] temperature was supplied but ${model} rejects temperature/top_p/top_k with ` +
          `a 400. Dropping it. Use effort ('low' … 'max') to trade thoroughness for cost.`,
      );
    }

    const params: Record<string, unknown> = {
      model,
      // Caps thinking *plus* response text — not the answer alone. Thinking is on
      // by default on Claude Opus 5, so a budget sized for the prose truncates.
      max_tokens: maxTokens,
      messages: toAnthropicMessages(normalizeMessages(request)),
      thinking: { type: "adaptive" },
      output_config: { effort: request.effort ?? this.config.effort },
    };

    const system = this._system(request);
    if (system) params["system"] = system;

    if (request.tools?.length) params["tools"] = request.tools.map(toAnthropicTool);

    if (this.config.fallbacks) {
      // `"default"` routes by refusal category, so there is no fallback model
      // list to maintain — and none to migrate when one is retired.
      params["fallbacks"] = "default";
      params["betas"] = [FALLBACK_BETA];
    }

    // Provider options are passed through untouched and last, so an app can set
    // anything this surface does not model — including overriding what it does.
    Object.assign(params, request.providerOptions?.["anthropic"] ?? {});

    return params;
  }

  /** The system prompt, marked cacheable when it is long enough to be worth it. */
  private _system(request: AiRequest): unknown {
    const text = request.system;
    if (!text) return undefined;

    const cache =
      (request.cache ?? this.config.cacheSystem) && text.length >= CACHEABLE_SYSTEM_CHARS;
    if (!cache) return text;

    return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
  }

  // ── Response handling ────────────────────────────────────────────────────

  private _toResponse(message: AnthropicMessage): AiResponse {
    this._assertNotRefused(message);

    const text = textOf(message.content);
    const toolCalls = toolCallsOf(message.content);

    return {
      text,
      model: message.model,
      usage: toUsage(message.usage),
      stopReason: toStopReason(message.stop_reason),
      toolCalls,
      // `raw` is the provider's own block list, replayed unchanged — see the
      // field's docs for why rebuilding it from `text` is not equivalent.
      assistantTurn: { role: "assistant", content: text, toolCalls, raw: message.content },
      raw: message,
    };
  }

  /**
   * A refusal arrives as HTTP **200** with empty or partial content.
   *
   * So this has to run before anything reads `content[0]` — otherwise the
   * failure mode is a crash on a response the API considers perfectly fine, at
   * whatever call site happened to index first.
   */
  private _assertNotRefused(message: AnthropicMessage, partialText = ""): void {
    if (message.stop_reason !== "refusal") return;
    const details = message.stop_details ?? {};
    throw new AiRefusedError(details.category ?? null, details.explanation ?? null, partialText);
  }

  // ── Loading and errors ───────────────────────────────────────────────────

  /** Load the optional SDK once, and keep both the class and the client. */
  private async _load(): Promise<LoadedAnthropic> {
    if (this._loaded) return this._loaded;
    this._loading ??= this._import();
    this._loaded = await this._loading;
    return this._loaded;
  }

  private async _import(): Promise<LoadedAnthropic> {
    // A non-literal specifier: the package is an optional peer, so the compiler
    // must not try to resolve it in apps that never installed it.
    const specifier = "@anthropic-ai/sdk";
    let loaded: unknown;
    try {
      loaded = await import(specifier);
    } catch {
      throw new AiDriverUnavailableError("anthropic", "@anthropic-ai/sdk");
    }

    const ctor = (loaded as AnthropicModule).default;
    const options: { apiKey: string; timeout: number; baseURL?: string } = {
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
    };
    if (this.config.baseUrl) options.baseURL = this.config.baseUrl;

    return { ctor, client: new ctor(options) };
  }

  /** Run a provider call, translating its failure into this package's vocabulary. */
  private async _call<T>(fn: () => Promise<T>, request?: AiRequest): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this._mapError(error, request);
    }
  }

  /**
   * Map an SDK error onto ours **by class**, never by matching its message.
   *
   * The SDK already retries 429s and 5xx with backoff, so there is deliberately
   * no retry here — a second layer would multiply the wait and hide the first.
   */
  private _mapError(error: unknown, request?: AiRequest): Error {
    if (request?.signal?.aborted) return new AiCancelledError();

    const ctor: AnthropicConstructor | undefined = this._loaded?.ctor;
    if (ctor) {
      if (error instanceof ctor.RateLimitError) {
        const retryAfter = retryAfterOf(error);
        return retryAfter === undefined
          ? new AiRateLimitError(error.message)
          : new AiRateLimitError(error.message, retryAfter);
      }
      if (error instanceof ctor.APIConnectionError) {
        return new AiRequestError(error.message, 0);
      }
      if (error instanceof ctor.APIError) {
        return new AiRequestError(error.message, (error as { status?: number }).status ?? 0);
      }
    }

    if (error instanceof Error && error.name === "AbortError") return new AiCancelledError();
    return error instanceof Error ? error : new Error(String(error));
  }
}

// ── Translation helpers ─────────────────────────────────────────────────────

/** Concatenate the text blocks; ignore thinking and tool blocks. */
function textOf(blocks: AnthropicBlock[]): string {
  let out = "";
  for (const block of blocks) {
    if (block.type === "text" && typeof block["text"] === "string") out += block["text"];
  }
  return out;
}

function toolCallsOf(blocks: AnthropicBlock[]): AiToolCall[] {
  const calls: AiToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== "tool_use") continue;
    calls.push({
      id: String(block["id"]),
      name: String(block["name"]),
      input: (block["input"] ?? {}) as Record<string, unknown>,
    });
  }
  return calls;
}

function toUsage(usage: AnthropicUsage): AiUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function toStopReason(reason: string | null): AiStopReason {
  switch (reason) {
    case "end_turn":
    case "max_tokens":
    case "tool_use":
    case "pause_turn":
    case "refusal":
    case "stop_sequence":
      return reason;
    default:
      return "unknown";
  }
}

function toAnthropicTool(tool: AiTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

/**
 * Turn this package's messages into the provider's.
 *
 * A turn that carries `raw` is replayed verbatim. That matters more than it
 * looks: an assistant turn containing thinking or cache blocks is rejected if
 * it is reconstructed from text, because the signature does not survive the
 * round trip.
 */
function toAnthropicMessages(messages: AiMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.raw !== undefined) return { role: message.role, content: message.raw };

    if (message.toolResults?.length) {
      return {
        role: "user",
        content: message.toolResults.map((result) => ({
          type: "tool_result",
          tool_use_id: result.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }

    if (message.toolCalls?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      return { role: message.role, content: blocks };
    }

    return { role: message.role, content: message.content };
  });
}

/** `retry-after`, when the SDK surfaced the header. */
function retryAfterOf(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown }).headers;
  if (!headers) return undefined;

  const raw =
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("retry-after")
      : ((headers as Record<string, string>)["retry-after"] ?? null);

  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}
