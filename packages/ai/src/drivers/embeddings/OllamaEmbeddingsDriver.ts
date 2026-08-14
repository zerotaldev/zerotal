import { AiCancelledError, AiRequestError } from "../../errors.ts";
import type { AiEmbedRequest, AiEmbedResponse } from "../../types.ts";
import { toInputs, type EmbeddingsDriver } from "./EmbeddingsDriver.ts";

interface OllamaEmbedResponse {
  model?: string;
  embeddings: number[][];
  prompt_eval_count?: number;
}

/** Ollama embeddings — a local server, so no key and no per-token cost. */
export class OllamaEmbeddingsDriver implements EmbeddingsDriver {
  readonly name = "ollama";

  constructor(
    private readonly config: { model: string; baseUrl: string; timeout: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async embed(request: AiEmbedRequest): Promise<AiEmbedResponse> {
    const model = request.model ?? this.config.model;
    const inputs = toInputs(request.input);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: inputs }),
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

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AiRequestError(
        `Ollama embeddings error ${response.status}: ${detail || response.statusText}`,
        response.status,
      );
    }

    const body = (await response.json()) as OllamaEmbedResponse;
    return {
      embeddings: body.embeddings,
      model: body.model ?? model,
      usage: { inputTokens: body.prompt_eval_count ?? 0 },
    };
  }
}
