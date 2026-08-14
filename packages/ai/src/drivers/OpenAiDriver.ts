import { AiCancelledError, AiRateLimitError, AiRequestError, AiSchemaError } from "../errors.ts";
import { recheckAgainstSchema, translateSchema, type SchemaInput } from "../schema.ts";
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
  OpenAiConfigShape,
} from "../types.ts";
import { normalizeMessages, type AiDriver, type DriverStatus } from "./AiDriver.ts";
import { readSse } from "./sse.ts";

/** One choice from a Chat Completions response. */
interface OpenAiChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  finish_reason?: string | null;
}

interface OpenAiCompletion {
  model: string;
  choices: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/**
 * The OpenAI driver — Chat Completions over `fetch`, no SDK.
 *
 * It exists to keep the abstraction honest. A provider-agnostic surface with one
 * implementation is an Anthropic client with extra indirection; the useful
 * questions ("does `object()` mean the same thing twice?", "does the agent loop
 * depend on Anthropic's block shapes?") only get asked when a second driver has
 * to answer them.
 */
export class OpenAiDriver implements AiDriver {
  readonly name = "openai";

  constructor(
    private readonly config: OpenAiConfigShape,
    /** Injected transport, for tests. Defaults to global `fetch`. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async text(request: AiRequest): Promise<AiResponse> {
    const body = this._body(request, false);
    const completion = await this._post<OpenAiCompletion>("/chat/completions", body, request);
    return this._toResponse(completion);
  }

  async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
    const body = this._body(request, true);
    body["stream"] = true;
    body["stream_options"] = { include_usage: true };

    const response = await this._send("/chat/completions", body, request);

    let text = "";
    let model = this.config.model;
    let finishReason: string | null = null;
    let usage: AiUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    for await (const event of readSse(response, request.signal)) {
      if (event === "[DONE]") break;

      let parsed: {
        model?: string;
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: OpenAiCompletion["usage"];
      };
      try {
        parsed = JSON.parse(event);
      } catch {
        continue; // A keep-alive comment or a partial frame; the next one carries it.
      }

      if (parsed.model) model = parsed.model;
      if (parsed.usage) usage = toUsage(parsed.usage);

      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: "text", text: delta };
      }
    }

    const result: AiResponse = {
      text,
      model,
      usage,
      stopReason: toStopReason(finishReason),
      toolCalls: [],
      assistantTurn: { role: "assistant", content: text },
    };
    yield { type: "done", response: result };
  }

  async object<T>(request: AiRequest, schema: SchemaInput): Promise<AiObjectResponse<T>> {
    const body = this._body(request, false);
    delete body["tools"];
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: "response", strict: true, schema: translateSchema(schema) },
    };

    const completion = await this._post<OpenAiCompletion>("/chat/completions", body, request);
    const text = completion.choices[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiSchemaError(
        `The model's answer was constrained to a schema but did not parse as JSON. This usually ` +
          `means the response was truncated (finish_reason ` +
          `${completion.choices[0]?.finish_reason ?? "null"}) — raise maxTokens.`,
        { text: text.slice(0, 200) },
      );
    }

    return {
      object: recheckAgainstSchema<T>(schema, parsed),
      model: completion.model,
      usage: toUsage(completion.usage),
      raw: completion,
    };
  }

  /**
   * Not implemented — there is no counting endpoint, and the only offline
   * tokenizer would be a guess dressed as a number. 0 means "unknown"; the spend
   * guard falls back to a labelled character approximation.
   */
  async countTokens(_request: AiRequest): Promise<number> {
    return 0;
  }

  async verify(): Promise<DriverStatus> {
    try {
      const response = await this.text({ prompt: "Reply with the single word: ok", maxTokens: 32 });
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

  // ── Wire ─────────────────────────────────────────────────────────────────

  private _body(request: AiRequest, streaming: boolean): Record<string, unknown> {
    const messages: Array<Record<string, unknown>> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    for (const message of normalizeMessages(request)) messages.push(...toOpenAiMessages(message));

    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      messages,
      max_completion_tokens: request.maxTokens ?? this.config.maxTokens,
    };

    if (request.temperature !== undefined) body["temperature"] = request.temperature;
    if (request.effort) body["reasoning_effort"] = request.effort;
    if (request.tools?.length) body["tools"] = request.tools.map(toOpenAiTool);
    if (streaming) body["stream"] = true;

    Object.assign(body, request.providerOptions?.["openai"] ?? {});
    return body;
  }

  private _toResponse(completion: OpenAiCompletion): AiResponse {
    const choice = completion.choices[0];
    const text = choice?.message?.content ?? "";
    const toolCalls: AiToolCall[] = (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      input: parseArguments(call.function.arguments),
    }));

    return {
      text,
      model: completion.model,
      usage: toUsage(completion.usage),
      stopReason: toStopReason(choice?.finish_reason ?? null),
      toolCalls,
      assistantTurn: { role: "assistant", content: text, toolCalls },
      raw: completion,
    };
  }

  private async _post<T>(
    path: string,
    body: Record<string, unknown>,
    request: AiRequest,
  ): Promise<T> {
    const response = await this._send(path, body, request);
    return (await response.json()) as T;
  }

  private async _send(
    path: string,
    body: Record<string, unknown>,
    request: AiRequest,
  ): Promise<Response> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(this.config.timeout),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, init);
    } catch (error) {
      if (request.signal?.aborted) throw new AiCancelledError();
      throw new AiRequestError(
        `Could not reach the OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    }

    if (response.ok) return response;

    const detail = await response.text().catch(() => "");
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const message = `OpenAI rate limit: ${detail || response.statusText}`;
      throw Number.isFinite(retryAfter) && retryAfter > 0
        ? new AiRateLimitError(message, retryAfter)
        : new AiRateLimitError(message);
    }
    throw new AiRequestError(
      `OpenAI API error ${response.status}: ${detail || response.statusText}`,
      response.status,
    );
  }
}

// ── Translation ─────────────────────────────────────────────────────────────

function toUsage(usage: OpenAiCompletion["usage"]): AiUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  };
}

function toStopReason(reason: string | null): AiStopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "refusal";
    default:
      return reason ? "unknown" : "end_turn";
  }
}

function toOpenAiTool(tool: AiTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: true,
    },
  };
}

/** One of ours becomes one or many of theirs — tool results are separate turns. */
function toOpenAiMessages(message: AiMessage): Array<Record<string, unknown>> {
  if (message.toolResults?.length) {
    return message.toolResults.map((result) => ({
      role: "tool",
      tool_call_id: result.id,
      content: result.content,
    }));
  }

  if (message.toolCalls?.length) {
    return [
      {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      },
    ];
  }

  return [{ role: message.role, content: message.content }];
}

/** Tool arguments arrive as a JSON *string*; a malformed one must not throw. */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
