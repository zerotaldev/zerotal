import { AiCancelledError, AiRequestError, AiSchemaError } from "../errors.ts";
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
  OllamaConfigShape,
} from "../types.ts";
import { normalizeMessages, type AiDriver, type DriverStatus } from "./AiDriver.ts";
import { readNdjson } from "./sse.ts";

interface OllamaChatResponse {
  model: string;
  message?: {
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * The Ollama driver — a local model server, so no API key and no billing.
 *
 * Its value here is not production traffic; it is that every test of the shared
 * surface can run against a real server someone has on their laptop, and that a
 * contributor with no provider account can still exercise the whole path.
 */
export class OllamaDriver implements AiDriver {
  readonly name = "ollama";

  constructor(
    private readonly config: OllamaConfigShape,
    /** Injected transport, for tests. Defaults to global `fetch`. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async text(request: AiRequest): Promise<AiResponse> {
    const body = this._body(request);
    body["stream"] = false;

    const response = await this._send("/api/chat", body, request);
    const chat = (await response.json()) as OllamaChatResponse;
    return this._toResponse(chat);
  }

  async *stream(request: AiRequest): AsyncIterable<AiStreamChunk> {
    const body = this._body(request);
    body["stream"] = true;

    const response = await this._send("/api/chat", body, request);

    let text = "";
    let last: OllamaChatResponse | undefined;

    for await (const line of readNdjson(response, request.signal)) {
      let chunk: OllamaChatResponse;
      try {
        chunk = JSON.parse(line) as OllamaChatResponse;
      } catch {
        continue;
      }

      last = chunk;
      const delta = chunk.message?.content;
      if (delta) {
        text += delta;
        yield { type: "text", text: delta };
      }
      if (chunk.done) break;
    }

    const toolCalls = toToolCalls(last?.message?.tool_calls);
    const result: AiResponse = {
      text,
      model: last?.model ?? this.config.model,
      usage: toUsage(last),
      stopReason: toStopReason(last?.done_reason ?? null, toolCalls.length > 0),
      toolCalls,
      assistantTurn: { role: "assistant", content: text, toolCalls },
    };

    for (const call of toolCalls) yield { type: "tool_call", call };
    yield { type: "done", response: result };
  }

  async object<T>(request: AiRequest, schema: SchemaInput): Promise<AiObjectResponse<T>> {
    const body = this._body(request);
    body["stream"] = false;
    delete body["tools"];
    // Ollama takes the JSON Schema directly as `format`, not wrapped.
    body["format"] = translateSchema(schema);

    const response = await this._send("/api/chat", body, request);
    const chat = (await response.json()) as OllamaChatResponse;
    const text = chat.message?.content ?? "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiSchemaError(
        `The model's answer was constrained to a schema but did not parse as JSON. Small local ` +
          `models frequently ignore the format constraint — try a larger one, or a driver whose ` +
          `provider enforces the schema server-side.`,
        { model: chat.model, text: text.slice(0, 200) },
      );
    }

    return {
      object: recheckAgainstSchema<T>(schema, parsed),
      model: chat.model,
      usage: toUsage(chat),
      raw: chat,
    };
  }

  /** Ollama reports `prompt_eval_count` only after generating. 0 means unknown. */
  async countTokens(_request: AiRequest): Promise<number | null> {
    // Ollama exposes no token-counting endpoint. `null`, not 0 — the caller can
    // tell "cannot count" from "counted nothing".
    return null;
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

  private _body(request: AiRequest): Record<string, unknown> {
    const messages: Array<Record<string, unknown>> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    for (const message of normalizeMessages(request)) messages.push(...toOllamaMessages(message));

    const options: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) options["num_predict"] = request.maxTokens;
    if (request.temperature !== undefined) options["temperature"] = request.temperature;

    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      messages,
    };
    if (Object.keys(options).length > 0) body["options"] = options;
    if (request.tools?.length) body["tools"] = request.tools.map(toOllamaTool);

    Object.assign(body, request.providerOptions?.["ollama"] ?? {});
    return body;
  }

  private _toResponse(chat: OllamaChatResponse): AiResponse {
    const text = chat.message?.content ?? "";
    const toolCalls = toToolCalls(chat.message?.tool_calls);

    return {
      text,
      model: chat.model,
      usage: toUsage(chat),
      stopReason: toStopReason(chat.done_reason ?? null, toolCalls.length > 0),
      toolCalls,
      assistantTurn: { role: "assistant", content: text, toolCalls },
      raw: chat,
    };
  }

  private async _send(
    path: string,
    body: Record<string, unknown>,
    request: AiRequest,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal ?? AbortSignal.timeout(this.config.timeout),
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AiCancelledError();
      throw new AiRequestError(
        `Could not reach Ollama at ${this.config.baseUrl}: ` +
          `${error instanceof Error ? error.message : String(error)}. Is \`ollama serve\` running?`,
        0,
      );
    }

    if (response.ok) return response;

    const detail = await response.text().catch(() => "");
    throw new AiRequestError(
      `Ollama error ${response.status}: ${detail || response.statusText}`,
      response.status,
    );
  }
}

// ── Translation ─────────────────────────────────────────────────────────────

function toUsage(chat: OllamaChatResponse | undefined): AiUsage {
  return {
    inputTokens: chat?.prompt_eval_count ?? 0,
    outputTokens: chat?.eval_count ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function toStopReason(reason: string | null, hasToolCalls: boolean): AiStopReason {
  if (hasToolCalls) return "tool_use";
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    default:
      return reason ? "unknown" : "end_turn";
  }
}

/** One tool call as Ollama reports it — arguments already parsed, and no id. */
type OllamaToolCall = { function: { name: string; arguments: Record<string, unknown> } };

/** Ollama omits call ids, so one is synthesized to keep the pairing addressable. */
function toToolCalls(calls: OllamaToolCall[] | undefined): AiToolCall[] {
  if (!calls) return [];
  return calls.map((call, index) => ({
    id: `ollama-${index}-${call.function.name}`,
    name: call.function.name,
    input: call.function.arguments ?? {},
  }));
}

function toOllamaTool(tool: AiTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toOllamaMessages(message: AiMessage): Array<Record<string, unknown>> {
  if (message.toolResults?.length) {
    return message.toolResults.map((result) => ({ role: "tool", content: result.content }));
  }

  if (message.toolCalls?.length) {
    return [
      {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.input },
        })),
      },
    ];
  }

  return [{ role: message.role, content: message.content }];
}
