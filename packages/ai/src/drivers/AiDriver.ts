import type { SchemaInput } from "../schema.ts";
import type {
  AiAgentResult,
  AiMessage,
  AiObjectResponse,
  AiRequest,
  AiResponse,
  AiStreamChunk,
} from "../types.ts";

/** What the agent loop needs from the caller, beyond the request itself. */
export interface AgentOptions {
  /** Hard ceiling on tool-calling round trips. */
  maxSteps: number;
  /** Hard ceiling on `pause_turn` resumes. */
  maxResumes: number;
  /**
   * Aborted when the caller cancels *or* when the loop's lock is lost.
   *
   * Distinct from `request.signal`: a lost lock means another process may now be
   * doing the same work, and continuing would double it.
   */
  signal: AbortSignal;
}

/**
 * What every AI provider implements.
 *
 * Deliberately small. A driver translates this vocabulary to one provider's wire
 * format and back; spend ceilings, redaction, telemetry, and the agent lock all
 * live above it in the manager, so a second driver costs a translation layer and
 * nothing else.
 */
export interface AiDriver {
  /** The driver's registered name — `anthropic`, `openai`, `ollama`, or custom. */
  readonly name: string;
  /** The configured default model. A request may override it. */
  readonly model: string;

  /** One non-streaming generation. */
  text(request: AiRequest): Promise<AiResponse>;

  /** One streaming generation. The final chunk is always `{ type: "done" }`. */
  stream(request: AiRequest): AsyncIterable<AiStreamChunk>;

  /** One generation constrained to a schema, parsed and re-checked. */
  object<T>(request: AiRequest, schema: SchemaInput): Promise<AiObjectResponse<T>>;

  /**
   * Run the tool-calling loop to completion.
   *
   * Optional, and normally left unimplemented: the shared loop in `agentLoop.ts`
   * drives any driver through {@link text}, so all three built-in drivers run
   * the *same* loop — which is the only way "the abstraction is real" is a claim
   * rather than a hope. Implement this only for a provider that executes tools
   * server-side and so cannot be driven turn by turn.
   */
  agent?(request: AiRequest, options: AgentOptions): Promise<AiAgentResult>;

  /**
   * Count the tokens this request would consume, using the provider's own
   * tokenizer. Never an estimate from another vendor's tokenizer — the spend
   * panel is built on this number.
   */
  countTokens(request: AiRequest): Promise<number>;

  /** Reach the provider once and report what came back. Backs `zt ai:test`. */
  verify(): Promise<DriverStatus>;
}

/** What `zt ai:test` prints for one driver. */
export interface DriverStatus {
  ok: boolean;
  /** The model the driver resolved — the thing people most often get wrong. */
  model: string;
  /** One line: the provider's reply, or its complaint. */
  detail: string;
}

/**
 * Turn `prompt` / `messages` into the single list drivers work from.
 *
 * @internal
 */
export function normalizeMessages(request: AiRequest): AiMessage[] {
  if (request.messages?.length) return request.messages;
  if (request.prompt !== undefined) return [{ role: "user", content: request.prompt }];
  return [];
}

/**
 * A short, redaction-safe label for telemetry: the last user turn, truncated by
 * the caller's redaction setting.
 *
 * @internal
 */
export function promptText(request: AiRequest): string {
  const messages = normalizeMessages(request);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && message.content) return message.content;
  }
  return request.system ?? "";
}
