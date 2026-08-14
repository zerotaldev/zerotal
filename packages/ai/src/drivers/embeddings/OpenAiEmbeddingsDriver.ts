import { AiCancelledError, AiRateLimitError, AiRequestError } from "../../errors.ts";
import type { AiEmbedRequest, AiEmbedResponse } from "../../types.ts";
import { toInputs, type EmbeddingsDriver } from "./EmbeddingsDriver.ts";

interface OpenAiEmbeddingResponse {
  model: string;
  data: Array<{ index: number; embedding: number[] }>;
  usage?: { prompt_tokens?: number };
}

/** OpenAI embeddings over `fetch`. No SDK, no dependency. */
export class OpenAiEmbeddingsDriver implements EmbeddingsDriver {
  readonly name = "openai";

  constructor(
    private readonly config: { apiKey: string; model: string; baseUrl: string; timeout: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async embed(request: AiEmbedRequest): Promise<AiEmbedResponse> {
    const inputs = toInputs(request.input);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: request.model ?? this.config.model, input: inputs }),
        signal: request.signal ?? AbortSignal.timeout(this.config.timeout),
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AiCancelledError();
      throw new AiRequestError(
        `Could not reach the OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new AiRateLimitError(`OpenAI rate limit: ${detail || response.statusText}`);
      }
      throw new AiRequestError(
        `OpenAI embeddings error ${response.status}: ${detail || response.statusText}`,
        response.status,
      );
    }

    const body = (await response.json()) as OpenAiEmbeddingResponse;

    // The API does not promise input order, and a mis-ordered batch silently
    // attaches every vector to the wrong document.
    const ordered = [...body.data].sort((a, b) => a.index - b.index);

    return {
      embeddings: ordered.map((entry) => entry.embedding),
      model: body.model,
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0 },
    };
  }
}
