import { Job, JobRegistry } from "@zerotal/queue";
import type { AiManager, AiQueueOptions } from "./AiManager.ts";
import type { AiRequest } from "./types.ts";

/** The wire form. Tools and signals cannot cross a queue, so they are dropped. */
interface QueuedGeneration {
  request: AiRequest;
  handler: string;
  meta: Record<string, unknown>;
}

/**
 * Background job behind `Ai.queue()`.
 *
 * Only the serializable half of a request survives the trip — `tools` carry
 * function handlers and `signal` is a live object, so both are stripped at
 * dispatch rather than silently arriving as `undefined` on the worker. A queued
 * generation is a one-shot completion, not an agent run; `Ai.agent()` stays
 * in-process where its tools are.
 *
 * @internal
 */
export class AiGenerationJob extends Job {
  override readonly queue: string;

  private readonly _data: QueuedGeneration;

  constructor(request: AiRequest, options: AiQueueOptions) {
    super();
    this.queue = options.queue ?? "ai";
    this._data = {
      request: serializableRequest(request),
      handler: options.handler,
      meta: options.meta ?? {},
    };
  }

  override payload(): Record<string, unknown> {
    return { ...this._data };
  }

  static fromPayload(data: Record<string, unknown>): AiGenerationJob {
    // Field by field rather than one cast over the whole record: this is the
    // boundary where a stored payload becomes typed, and naming each key makes
    // it obvious what an older or hand-edited row is allowed to be missing.
    return new AiGenerationJob((data["request"] ?? {}) as AiRequest, {
      handler: String(data["handler"] ?? ""),
      meta: (data["meta"] as Record<string, unknown> | undefined) ?? {},
    });
  }

  async handle(): Promise<void> {
    const { currentApp } = await import("@zerotal/core");
    const ai = currentApp().container.makeSync("ai") as AiManager;

    const handler = ai.handlerFor(this._data.handler);
    if (!handler) {
      throw new Error(
        `[Zerotal/ai] This worker has no queued-generation handler named ` +
          `'${this._data.handler}'. Register it in a service provider so the worker process ` +
          `sees it too — registering it in a route only reaches the web process.`,
      );
    }

    const response = await ai.generate(this._data.request);
    await handler(response, this._data.meta);
  }
}

/** Strip everything that cannot survive JSON. */
function serializableRequest(request: AiRequest): AiRequest {
  const { tools: _tools, signal: _signal, ...rest } = request;
  return rest;
}

JobRegistry.register(AiGenerationJob);
