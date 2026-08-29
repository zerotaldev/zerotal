/**
 * The slice of `@anthropic-ai/sdk` this package uses, declared structurally.
 *
 * The SDK is an **optional** peer dependency: an app that only talks to Ollama
 * should install nothing. That rules out importing its types, because a missing
 * package is a `tsc` failure for every consumer, not just the ones using it. So
 * the shape lives here instead, and the module is loaded through a non-literal
 * specifier so the compiler never tries to resolve it.
 *
 * The cost is that this file, alone in the package, is only as correct as the
 * SDK's documented wire format. Everything it touches is exercised by
 * `AnthropicDriver.test.ts` against an injected stub built to these same types —
 * which pins our *use* of the shapes, not the shapes themselves. Keep it small.
 */

/** A content block in a response. Unknown block types keep their raw fields. */
export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** Token accounting, as the API reports it. */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Populated only when `stop_reason` is `refusal`; `null` otherwise. */
export interface AnthropicStopDetails {
  type?: string;
  category?: string | null;
  explanation?: string | null;
}

/** One finished message. */
export interface AnthropicMessage {
  id?: string;
  model: string;
  content: AnthropicBlock[];
  stop_reason: string | null;
  stop_details?: AnthropicStopDetails | null;
  usage: AnthropicUsage;
}

/** The stream events this package reads. Others are ignored. */
export type AnthropicStreamEvent =
  | {
      type: "content_block_delta";
      delta:
        | { type: "text_delta"; text: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: string; [key: string]: unknown };
    }
  | { type: string; [key: string]: unknown };

/** What `messages.stream()` returns. */
export interface AnthropicMessageStream extends AsyncIterable<AnthropicStreamEvent> {
  finalMessage(): Promise<AnthropicMessage>;
  abort?(): void;
}

/** Per-request options. Note the SDK's timeout is in **milliseconds**. */
export interface AnthropicRequestOptions {
  signal?: AbortSignal | undefined;
  timeout?: number | undefined;
}

/** One `messages` namespace — the shape is identical on `client` and `client.beta`. */
export interface AnthropicMessagesApi {
  create(
    params: Record<string, unknown>,
    options?: AnthropicRequestOptions,
  ): Promise<AnthropicMessage>;
  stream(
    params: Record<string, unknown>,
    options?: AnthropicRequestOptions,
  ): AnthropicMessageStream;
  countTokens?(
    params: Record<string, unknown>,
    options?: AnthropicRequestOptions,
  ): Promise<{ input_tokens: number }>;
}

/** The client surface this driver drives. */
export interface AnthropicClient {
  messages: AnthropicMessagesApi;
  beta: { messages: AnthropicMessagesApi };
}

/** Anything `instanceof` can be tested against. */
export type ErrorClass = new (...args: never[]) => Error;

/**
 * The SDK's default export: a constructor that also carries the typed error
 * classes. Mapping errors **by class** rather than by matching message text is
 * the difference between a rate limit staying a rate limit and it becoming
 * whatever the provider decides to call it next quarter.
 */
export interface AnthropicConstructor {
  new (options: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
    maxRetries?: number;
  }): AnthropicClient;
  RateLimitError: ErrorClass;
  APIConnectionError: ErrorClass;
  AuthenticationError: ErrorClass;
  NotFoundError: ErrorClass;
  BadRequestError: ErrorClass;
  APIError: ErrorClass;
}

/** The module namespace. */
export interface AnthropicModule {
  default: AnthropicConstructor;
}

/** Both halves of a loaded SDK: the class (for `instanceof`) and a client. */
export interface LoadedAnthropic {
  ctor: AnthropicConstructor;
  client: AnthropicClient;
}
