/**
 * Provider-agnostic AI generation for Zerotal.
 *
 * Text, streaming, structured output, typed tools, and an agent loop, behind one
 * facade — with the provider chosen in config rather than in every call site.
 *
 * @example
 * ```ts
 * import { Ai, tool } from "@zerotal/ai";
 *
 * const summary = await Ai.text(`Summarize in one sentence:\n\n${article}`);
 *
 * for await (const chunk of Ai.stream({ prompt, signal: this.signal })) {
 *   if (chunk.type === "text") this.answer += chunk.text;
 * }
 *
 * const review = await Ai.object({ prompt }, (rule) => ({
 *   sentiment: rule.string().in(["positive", "neutral", "negative"]),
 *   score:     rule.number().min(1).max(5),
 * }));
 *
 * const result = await Ai.agent({ prompt, tools: [lookupOrder], lock: "order:4821" });
 * ```
 *
 * @packageDocumentation
 */

export { AiManager } from "./AiManager.ts";
export type { AiAgentRequest, AiQueueHandler, AiQueueOptions } from "./AiManager.ts";
export { Ai } from "./facades/Ai.ts";
export { AiProvider } from "./provider/AiProvider.ts";
export { AiConfig, AiConfigFromEnv, validateAiConfig } from "./config.ts";
export type { AiConfigInput } from "./config.ts";
export { AiFake } from "./AiFake.ts";
export type { CapturedGeneration } from "./AiFake.ts";

// Tools
export { tool } from "./tool.ts";

// Schema translation — exported so a test can pin the exact JSON Schema a
// validator schema produces, which is the only way that stays honest.
export { translateSchema, strippedConstraints, toSchema } from "./schema.ts";
export type { SchemaInput } from "./schema.ts";

// Drivers — implement the interface to add a provider, or instantiate directly.
export { AnthropicDriver } from "./drivers/AnthropicDriver.ts";
export { OpenAiDriver } from "./drivers/OpenAiDriver.ts";
export { OllamaDriver } from "./drivers/OllamaDriver.ts";
export type { AiDriver, AgentOptions, DriverStatus } from "./drivers/AiDriver.ts";

// Embeddings — their own driver, because Anthropic has no embeddings endpoint.
export { OpenAiEmbeddingsDriver } from "./drivers/embeddings/OpenAiEmbeddingsDriver.ts";
export { OllamaEmbeddingsDriver } from "./drivers/embeddings/OllamaEmbeddingsDriver.ts";
export type { EmbeddingsDriver } from "./drivers/embeddings/EmbeddingsDriver.ts";

// Background generation
export { AiGenerationJob } from "./AiGenerationJob.ts";

// Cost estimation — extend the table for a model this package does not price.
export { estimateCost, modelPrice, registerModelPrice, modelRejectsSampling } from "./pricing.ts";
export type { ModelPrice } from "./pricing.ts";

// Spend ledger
export { spentToday, resetSpend } from "./spend.ts";

// Counters backing the monitor section
export { modelStats, recentGenerations, refusalRate, resetStats } from "./stats.ts";
export type { AiDelivery, ModelStat } from "./stats.ts";

// Console commands
export { AiTestCommand, AiSpendCommand } from "./commands/index.ts";

// Typed error vocabulary
export * from "./errors.ts";

// Framework instrumentation events (emitted on the core FrameworkEvents bus)
export { AiGenerated, AiRefused, AiToolCalled } from "./events.ts";

export type {
  AiAgentResult,
  AiAgentStep,
  AiConfigShape,
  AiEffort,
  AiEmbedRequest,
  AiEmbedResponse,
  AiLimitsConfigShape,
  AiAgentConfigShape,
  AiMessage,
  AiObjectResponse,
  AiProviderOptions,
  AiRequest,
  AiResponse,
  AiRole,
  AiStopReason,
  AiStreamChunk,
  AiTool,
  AiToolCall,
  AiToolContext,
  AiToolResult,
  AiUsage,
  AnthropicConfigShape,
  EmbeddingsConfigShape,
  JsonSchema,
  OllamaConfigShape,
  OpenAiConfigShape,
} from "./types.ts";
