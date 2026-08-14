/**
 * The AI package's framework events, emitted on core's `FrameworkEvents` bus.
 * Observability packages subscribe to them by class; nothing here imports them.
 *
 * Prompt text on these events has already been through {@link redactPrompt} —
 * a prompt is user data, and the observability path is the one place it would
 * otherwise be durably kept.
 */

/** Emitted after a generation finishes, whether it succeeded or not. */
export class AiGenerated {
  constructor(
    /** The driver that served it: "anthropic" | "openai" | "ollama" | custom. */
    readonly driver: string,
    readonly model: string,
    /** "text" | "stream" | "object" | "agent" | "embed". */
    readonly operation: string,
    readonly inputTokens: number,
    readonly outputTokens: number,
    readonly cacheReadTokens: number,
    readonly durationMs: number,
    /** Estimated cost in USD, from the driver's price table. 0 when unpriced. */
    readonly costUsd: number,
    readonly ok: boolean,
    /** Redacted prompt preview — never the raw prompt. */
    readonly preview: string,
    readonly error?: string,
  ) {}
}

/** Emitted when the provider's safety classifiers declined a request. */
export class AiRefused {
  constructor(
    readonly driver: string,
    readonly model: string,
    readonly category: string | null,
    readonly preview: string,
  ) {}
}

/** Emitted once per tool call inside an agent run. */
export class AiToolCalled {
  constructor(
    readonly driver: string,
    readonly tool: string,
    readonly step: number,
    readonly durationMs: number,
    readonly ok: boolean,
    readonly error?: string,
  ) {}
}
