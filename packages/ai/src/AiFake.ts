import { Application, currentApp } from "@zerotal/core";
import { AiRefusedError, AiSchemaError } from "./errors.ts";
import { recheckAgainstSchema, _resolveSchema, type SchemaInput } from "./schema.ts";
import type { RuleBuilder } from "@zerotal/validator";
import { normalizeMessages, promptText, type DriverStatus } from "./drivers/AiDriver.ts";
import type { AiAgentRequest, AiQueueHandler, AiQueueOptions } from "./AiManager.ts";
import type {
  AiAgentResult,
  AiEmbedRequest,
  AiEmbedResponse,
  AiRequest,
  AiResponse,
  AiStreamChunk,
  AiUsage,
} from "./types.ts";

type Binding = unknown;

/** One recorded call. */
export interface CapturedGeneration {
  /** `"text" | "stream" | "object" | "agent" | "embed" | "queue"`. */
  operation: string;
  /** The last user turn, unredacted — this is a test, and it is in memory. */
  prompt: string;
  system: string | undefined;
  request: AiRequest;
}

/** What the fake returns when nothing more specific was queued. */
const DEFAULT_TEXT = "This is a fake AI response.";

const NO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * Drop-in replacement for {@link AiManager} that records prompts and answers
 * from a script, instead of calling a provider.
 *
 * This is the piece that makes an AI feature testable at all: the assertions are
 * about *what your application asked for*, which is the part you wrote and the
 * part that can be wrong. Whether the model's prose is good is not a unit test.
 *
 * @example
 * const ai = AiFake.install();
 * ai.respondWith("A one-sentence summary.");
 *
 * await service.summarize(article);
 *
 * ai.assertPrompted(/Summarize/);
 * ai.assertPromptCount(1);
 * ai.restore();     // in afterEach
 */
export class AiFake {
  private readonly _calls: CapturedGeneration[] = [];
  private readonly _texts: string[] = [];
  private readonly _objects: unknown[] = [];
  private readonly _handlers = new Map<string, AiQueueHandler>();
  private _refuseWith: { category: string | null; explanation: string | null } | undefined;

  private constructor(
    private readonly _app: Application,
    private readonly _original: Binding,
  ) {}

  /** Replace the `ai` container binding with this fake. */
  static install(): AiFake {
    const app = currentApp();
    const original = app.container.registry.get("ai");
    const fake = new AiFake(app, original);
    app.container.value("ai", fake);
    return fake;
  }

  /** Restore the original `ai` binding. Call in `afterEach`. */
  restore(): void {
    if (this._original !== undefined) {
      this._app.container.registry.set("ai", this._original as never);
    } else {
      this._app.container.registry.delete("ai");
    }
  }

  // ── Scripting ────────────────────────────────────────────────────────────

  /**
   * Queue one or more text answers, returned in order. The last one repeats
   * once the queue is exhausted, so a test that does not care how many calls
   * happen does not have to count them.
   */
  respondWith(...texts: string[]): this {
    this._texts.push(...texts);
    return this;
  }

  /** Queue one or more answers for `object()`, returned in order. */
  respondWithObject(...objects: unknown[]): this {
    this._objects.push(...objects);
    return this;
  }

  /**
   * Make the next call refuse, as the provider's safety classifiers would.
   *
   * Worth testing deliberately: a refusal is an HTTP 200 with no content, so the
   * handling path is the one most likely to have never run.
   */
  refuse(category: string | null = "cyber", explanation: string | null = null): this {
    this._refuseWith = { category, explanation };
    return this;
  }

  // ── The AiManager surface ────────────────────────────────────────────────

  async text(request: AiRequest | string): Promise<string> {
    return (await this.generate(request)).text;
  }

  async generate(request: AiRequest | string): Promise<AiResponse> {
    const normalized = capture(request);
    this._record("text", normalized);
    this._maybeRefuse();

    const text = this._nextText();
    return {
      text,
      model: "fake",
      usage: NO_USAGE,
      stopReason: "end_turn",
      toolCalls: [],
      assistantTurn: { role: "assistant", content: text },
    };
  }

  async *stream(request: AiRequest | string): AsyncIterable<AiStreamChunk> {
    const normalized = capture(request);
    this._record("stream", normalized);
    this._maybeRefuse();

    const text = this._nextText();
    // Word by word, because a caller that only ever sees one chunk is not
    // actually exercising its accumulation.
    for (const word of text.split(/(\s+)/)) {
      if (word) yield { type: "text", text: word };
    }

    yield {
      type: "done",
      response: {
        text,
        model: "fake",
        usage: NO_USAGE,
        stopReason: "end_turn",
        toolCalls: [],
        assistantTurn: { role: "assistant", content: text },
      },
    };
  }

  /**
   * Return the next scripted object — after checking it against the same schema the
   * real driver would.
   *
   * This used to hand the canned value back unexamined, and that is a fake that
   * makes tests *less* informative than no test. An app scripted `{ month: "" }`,
   * eleven tests passed on it, and the live path rejected the identical answer every
   * time — so the suite was green about a feature that returned nothing in
   * production. The permissive fake is what made the schema bug invisible; they are
   * the same defect seen from both ends.
   *
   * The check runs only when the caller passed a schema, because that is the only
   * case where there is anything to check. A mismatch throws here, in the test, with
   * the field named — which is the whole point.
   *
   * @param request - The request, or just a prompt.
   * @param schema - The schema the production call declares.
   */
  async object<T = Record<string, unknown>>(
    request: AiRequest | string,
    schema?: SchemaInput | ((rule: RuleBuilder) => SchemaInput),
  ): Promise<T> {
    const normalized = capture(request);
    this._record("object", normalized);
    this._maybeRefuse();

    if (this._objects.length === 0) {
      throw new Error(
        "[Zerotal/ai] AiFake had no scripted object to return. Call " +
          "ai.respondWithObject({ … }) before the code under test runs.",
      );
    }

    const scripted = (
      this._objects.length > 1 ? this._objects.shift() : this._objects[0]
    ) as unknown;

    if (schema === undefined) return scripted as T;

    const resolved = await _resolveSchema(schema);
    try {
      return recheckAgainstSchema<T>(resolved, scripted);
    } catch (error) {
      throw new AiSchemaError(
        `[Zerotal/ai] The object scripted with respondWithObject() does not satisfy the ` +
          `schema this call declares, so the real driver would reject it too — and a test ` +
          `passing on it would be green about a call that fails in production.
  ` +
          `${(error as Error).message}`,
        { scripted },
      );
    }
  }

  async agent(request: AiAgentRequest): Promise<AiAgentResult> {
    this._record("agent", request);
    this._maybeRefuse();

    return {
      text: this._nextText(),
      model: "fake",
      usage: NO_USAGE,
      steps: [],
      stopReason: "end_turn",
    };
  }

  async embed(
    input: string | string[],
    _options: Omit<AiEmbedRequest, "input"> = {},
  ): Promise<AiEmbedResponse> {
    const inputs = Array.isArray(input) ? input : [input];
    this._record("embed", { prompt: inputs.join("\n") });

    // A deterministic, non-zero vector: a test asserting "these two differ"
    // should pass, and one asserting a specific value should not.
    return {
      embeddings: inputs.map((value) => [value.length, value.charCodeAt(0) || 0, 0]),
      model: "fake",
      usage: { inputTokens: 0 },
    };
  }

  async countTokens(request: AiRequest | string): Promise<number> {
    const normalized = capture(request);
    return Math.ceil(promptText(normalized).length / 4);
  }

  async verify(): Promise<DriverStatus> {
    return { ok: true, model: "fake", detail: "AiFake is installed — no provider was contacted." };
  }

  onGenerated(name: string, handler: AiQueueHandler): this {
    this._handlers.set(name, handler);
    return this;
  }

  handlerFor(name: string): AiQueueHandler | undefined {
    return this._handlers.get(name);
  }

  /** Records the call and runs the handler inline — no worker, no queue driver. */
  async queue(request: AiRequest, options: AiQueueOptions): Promise<void> {
    this._record("queue", request);
    const handler = this._handlers.get(options.handler);
    if (handler) await handler(await this.generate(request), options.meta ?? {});
  }

  drivers(): string[] {
    return ["fake"];
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  /** Every recorded call, in order. */
  get calls(): CapturedGeneration[] {
    return [...this._calls];
  }

  /** Just the prompts, in order. */
  get prompts(): string[] {
    return this._calls.map((call) => call.prompt);
  }

  /**
   * Assert some prompt matched.
   *
   * @param expected - A substring, a regular expression, or a predicate.
   */
  assertPrompted(expected: string | RegExp | ((prompt: string) => boolean)): void {
    const matches = this._calls.some((call) => matchPrompt(call.prompt, expected));
    if (matches) return;

    throw new Error(
      `[Zerotal/ai] Expected a prompt matching ${describe(expected)}, but ` +
        (this._calls.length === 0
          ? "nothing was prompted."
          : `the ${this._calls.length} prompt(s) were:\n` +
            this.prompts.map((p) => `  - ${truncate(p)}`).join("\n")),
    );
  }

  /** Assert no prompt matched. */
  assertNotPrompted(expected: string | RegExp | ((prompt: string) => boolean)): void {
    const match = this._calls.find((call) => matchPrompt(call.prompt, expected));
    if (!match) return;
    throw new Error(
      `[Zerotal/ai] Expected no prompt matching ${describe(expected)}, but found: ${truncate(match.prompt)}`,
    );
  }

  /** Assert the system prompt of some call matched. */
  assertSystemPrompted(expected: string | RegExp | ((prompt: string) => boolean)): void {
    const matches = this._calls.some(
      (call) => call.system !== undefined && matchPrompt(call.system, expected),
    );
    if (matches) return;
    throw new Error(
      `[Zerotal/ai] Expected a system prompt matching ${describe(expected)}, but ` +
        `none of the ${this._calls.length} call(s) had one that did.`,
    );
  }

  /** Assert exactly `count` generations happened. */
  assertPromptCount(count: number): void {
    if (this._calls.length === count) return;
    throw new Error(
      `[Zerotal/ai] Expected ${count} generation(s), got ${this._calls.length}.` +
        (this._calls.length > 0
          ? `\n${this._calls.map((c) => `  - ${c.operation}: ${truncate(c.prompt)}`).join("\n")}`
          : ""),
    );
  }

  /** Assert nothing was generated. */
  assertNothingPrompted(): void {
    this.assertPromptCount(0);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _record(operation: string, request: Partial<AiRequest> & { prompt?: string }): void {
    const full = request as AiRequest;
    this._calls.push({
      operation,
      prompt: promptText(full) || (request.prompt ?? ""),
      system: full.system,
      request: full,
    });
  }

  private _nextText(): string {
    if (this._texts.length === 0) return DEFAULT_TEXT;
    return this._texts.length > 1 ? this._texts.shift()! : this._texts[0]!;
  }

  private _maybeRefuse(): void {
    if (!this._refuseWith) return;
    const { category, explanation } = this._refuseWith;
    this._refuseWith = undefined;
    throw new AiRefusedError(category, explanation);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function capture(request: AiRequest | string): AiRequest {
  return typeof request === "string" ? { prompt: request } : request;
}

function matchPrompt(
  prompt: string,
  expected: string | RegExp | ((prompt: string) => boolean),
): boolean {
  if (typeof expected === "function") return expected(prompt);
  if (expected instanceof RegExp) return expected.test(prompt);
  return prompt.includes(expected);
}

function describe(expected: string | RegExp | ((prompt: string) => boolean)): string {
  if (typeof expected === "function") return "the given predicate";
  if (expected instanceof RegExp) return String(expected);
  return `"${expected}"`;
}

function truncate(text: string, limit = 120): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Re-exported so a fake's caller can normalise messages the same way. @internal */
export { normalizeMessages };
