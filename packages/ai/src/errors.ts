import { ZerotalError } from "@zerotal/core";

/** Base class for all `@zerotal/ai` errors. */
export class AiError extends ZerotalError {
  constructor(message: string, code = "E_AI", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** Thrown for a driver name the manager does not know. */
export class UnknownAiDriverError extends AiError {
  constructor(driver: string, known: string[] = []) {
    super(
      `Unknown AI driver: '${driver}'.` +
        (known.length > 0
          ? ` Configured: ${known.join(", ")}. Add your own with Ai.extend("${driver}", () => …).`
          : " Configure one under drivers in config/ai.ts."),
      "E_AI_UNKNOWN_DRIVER",
      500,
      { driver, known },
    );
  }
}

/** Thrown at boot, or on first use, for a config combination that cannot work. */
export class AiConfigError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Zerotal/ai] ${message}`, "E_AI_CONFIG", 500, context);
  }
}

/**
 * Thrown when a driver's optional peer package is not installed.
 *
 * The SDKs are optional peers so an app that only talks to Ollama installs
 * nothing; the cost is that the failure has to name the missing package.
 */
export class AiDriverUnavailableError extends AiError {
  constructor(driver: string, packageName: string) {
    super(
      `[Zerotal/ai] The '${driver}' driver needs ${packageName}, which is not installed. ` +
        `Run: bun add ${packageName}`,
      "E_AI_DRIVER_UNAVAILABLE",
      500,
      { driver, packageName },
    );
  }
}

/**
 * Thrown when the provider's safety classifiers declined the request.
 *
 * This arrives as a **successful** HTTP 200 with an empty or partial body, so a
 * caller that reads `content[0]` without checking the stop reason crashes on a
 * response the API considers fine. Raising a typed error is the whole point.
 */
export class AiRefusedError extends AiError {
  constructor(
    /** The provider's refusal category, when it gave one — `cyber`, `bio`, … */
    readonly category: string | null,
    /** The provider's own explanation, when it gave one. */
    readonly explanation: string | null,
    /** Whatever text arrived before the refusal, for a mid-stream decline. */
    readonly partialText = "",
  ) {
    super(
      `[Zerotal/ai] The model declined the request` +
        (category ? ` (${category})` : "") +
        (explanation ? `: ${explanation}` : "."),
      "E_AI_REFUSED",
      // Not a server fault and not the caller's malformed input — it is a
      // policy decision about the content, which is what 422 says.
      422,
      { category, explanation },
    );
  }
}

/** Thrown when the provider rate-limits. The SDKs already retried. */
export class AiRateLimitError extends AiError {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`[Zerotal/ai] ${message}`, "E_AI_RATE_LIMIT", 429, { retryAfterSeconds });
  }
}

/** Thrown for any other non-2xx from the provider, carrying its status. */
export class AiRequestError extends AiError {
  constructor(
    message: string,
    readonly providerStatus: number,
    context?: Record<string, unknown>,
  ) {
    super(`[Zerotal/ai] ${message}`, "E_AI_REQUEST", providerStatus >= 500 ? 502 : 400, {
      providerStatus,
      ...context,
    });
  }
}

/** Thrown when a request would breach a configured spend ceiling. */
export class AiSpendLimitError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Zerotal/ai] ${message}`, "E_AI_SPEND_LIMIT", 429, context);
  }
}

/** Thrown when a validator schema uses a constraint structured output cannot express. */
export class AiSchemaError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Zerotal/ai] ${message}`, "E_AI_SCHEMA", 500, context);
  }
}

/** Thrown when the agent loop hits its step or resume ceiling. */
export class AiAgentLimitError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Zerotal/ai] ${message}`, "E_AI_AGENT_LIMIT", 500, context);
  }
}

/** Thrown when the caller's `AbortSignal` fired before the call finished. */
export class AiCancelledError extends AiError {
  constructor(message = "The generation was cancelled.") {
    super(`[Zerotal/ai] ${message}`, "E_AI_CANCELLED", 499);
  }
}
