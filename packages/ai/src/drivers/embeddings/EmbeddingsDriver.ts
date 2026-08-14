import type { AiEmbedRequest, AiEmbedResponse } from "../../types.ts";

/**
 * What an embeddings provider implements.
 *
 * Separate from {@link AiDriver} on purpose, and separately configured: Anthropic
 * has no embeddings endpoint at all, so a design that hangs `embed()` off the
 * generation driver makes the normal pairing — Claude for generation, something
 * cheaper for vectors — impossible to express.
 */
export interface EmbeddingsDriver {
  readonly name: string;
  readonly model: string;
  embed(request: AiEmbedRequest): Promise<AiEmbedResponse>;
}

/** Normalise `string | string[]` to the list every provider actually wants. */
export function toInputs(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}
