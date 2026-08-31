import { ZerotalError } from "@zerotal/core";

/**
 * Base class for all `@zerotal/ai` errors.
 *
 * Every one of them carries {@link transient}, because the caller cannot work it out
 * and the package can.
 */
export class AiError extends ZerotalError {
  /**
   * Whether retrying could plausibly succeed — `true` for *this call failed*, `false`
   * for *this machine cannot do this*.
   *
   * The distinction exists because a service that calls a model per row has to latch
   * itself off after a permanent failure. Without that, a laptop with no API key pays
   * the driver's timeout per row, per merchant, per page load — measured at 8s × 12
   * merchants, which is ninety seconds of blank page.
   *
   * Writing that latch meant classifying eleven error classes by hand, and the
   * permissive mistake is unrecoverable: get it wrong toward "permanent" and a
   * feature disables itself for the lifetime of the process, silently, because every
   * call site already treats "no answer" as normal. An app classified
   * {@link AiSchemaError} as permanent and would have turned two features off on
   * their first badly-shaped answer.
   *
   * So the judgement lives here, where the knowledge is. Only this package knows
   * whether a new error class means "this call" or "this machine".
   *
   * @example
   * ```ts
   * try {
   *   return await Ai.object(prompt, schema);
   * } catch (error) {
   *   if (error instanceof AiError && !error.transient) this.disabled = true;
   *   return null;
   * }
   * ```
   */
  readonly transient: boolean;

  constructor(
    message: string,
    code = "E_AI",
    status = 500,
    context?: Record<string, unknown>,
    transient = false,
  ) {
    super(message, code, status, context);
    this.transient = transient;
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
      // A name that does not exist will not start existing. Permanent.
      false,
    );
  }
}

/** Thrown at boot, or on first use, for a config combination that cannot work. */
export class AiConfigError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    // Configuration does not fix itself between two calls. Permanent.
    super(`[Zerotal/ai] ${message}`, "E_AI_CONFIG", 500, context, false);
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
      // A missing package is missing for the life of the process. Permanent, and the
      // one this distinction exists for — it is what a laptop with no key hits.
      false,
    );
  }

  /**
   * The variant for an app that has configured no AI at all.
   *
   * Deliberately this class rather than a new one. "No driver is installed" and "no
   * driver is configured" are the same fact to a caller — AI cannot answer here, and
   * will not start being able to mid-process — and every consumer's handling is
   * already written against the four permanent classes. A fifth would fall outside
   * it silently, which is the failure mode a shared error taxonomy exists to prevent.
   *
   * @param requested - The driver name that was asked for.
   */
  static notConfigured(requested: string): AiDriverUnavailableError {
    const error = new AiDriverUnavailableError(requested, "a provider SDK");
    return Object.assign(error, {
      message:
        `[Zerotal/ai] No AI driver is configured, so there is nothing to generate with. ` +
        `This is a supported state — an app can ship with AI off. Add a driver under ` +
        `'drivers' in config/ai.ts to turn it on.`,
      context: { requested, configured: [] as string[] },
    });
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
      // Transient: a refusal is about *this content*, not about the machine. The
      // next prompt may be fine, and latching a feature off because one request was
      // declined would disable it for everybody over one user's question.
      true,
    );
  }
}

/** Thrown when the provider rate-limits. The SDKs already retried. */
export class AiRateLimitError extends AiError {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    // The provider is telling you when to come back. Transient by definition.
    super(`[Zerotal/ai] ${message}`, "E_AI_RATE_LIMIT", 429, { retryAfterSeconds }, true);
  }
}

/** Thrown for any other non-2xx from the provider, carrying its status. */
export class AiRequestError extends AiError {
  constructor(
    message: string,
    readonly providerStatus: number,
    context?: Record<string, unknown>,
  ) {
    super(
      `[Zerotal/ai] ${message}`,
      "E_AI_REQUEST",
      providerStatus >= 500 ? 502 : 400,
      { providerStatus, ...context },
      // The only classification here that reads a value, and the split is the
      // provider's own: 5xx is the provider having a bad moment and 408/429 say so
      // outright, while a 4xx is this request being wrong in a way that repeating it
      // will not fix — a bad key, a model name that does not exist, a payload the
      // API rejects.
      providerStatus >= 500 || providerStatus === 408 || providerStatus === 429,
    );
  }
}

/** Thrown when a request would breach a configured spend ceiling. */
export class AiSpendLimitError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    // A budget resets on its window. Transient, though a caller may reasonably
    // back off much harder than it would for a rate limit.
    super(`[Zerotal/ai] ${message}`, "E_AI_SPEND_LIMIT", 429, context, true);
  }
}

/** Thrown when a validator schema uses a constraint structured output cannot express. */
export class AiSchemaError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    // Transient, and deliberately so. A model that shaped one answer badly may
    // shape the next one correctly — sampling is not deterministic. An app called
    // this permanent and would have disabled two features on a single bad reply.
    super(`[Zerotal/ai] ${message}`, "E_AI_SCHEMA", 500, context, true);
  }
}

/** Thrown when the agent loop hits its step or resume ceiling. */
export class AiAgentLimitError extends AiError {
  constructor(message: string, context?: Record<string, unknown>) {
    // The loop hit its own ceiling on this run. Another run may not. Transient.
    super(`[Zerotal/ai] ${message}`, "E_AI_AGENT_LIMIT", 500, context, true);
  }
}

/** Thrown when the caller's `AbortSignal` fired before the call finished. */
export class AiCancelledError extends AiError {
  constructor(message = "The generation was cancelled.") {
    // Somebody asked for this to stop. Nothing is wrong with the machine.
    super(`[Zerotal/ai] ${message}`, "E_AI_CANCELLED", 499, undefined, true);
  }
}
