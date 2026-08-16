import { deepMerge } from "@zerotal/core";
import type { DeepPartial } from "@zerotal/core";
import { AiConfigError } from "./errors.ts";
import type {
  AiConfigShape,
  AnthropicConfigShape,
  EmbeddingsConfigShape,
  OllamaConfigShape,
  OpenAiConfigShape,
} from "./types.ts";
import { modelRejectsSampling } from "./pricing.ts";

/**
 * What {@link AiConfig} accepts — every key optional, all the way down. The
 * same type the factory's parameter is written as, exported under a name
 * consumers can reach for.
 *
 * Exported because a real `config/ai.ts` often builds its driver map
 * conditionally ("Anthropic when the key is set, Ollama otherwise"), and the
 * intermediate variable needs a type that is not the fully-resolved shape.
 *
 * @example
 * const drivers: NonNullable<AiConfigInput["drivers"]> = { ollama: { model } };
 * if (key) drivers.anthropic = { apiKey: key };
 * export default AiConfig({ default: key ? "anthropic" : "ollama", drivers });
 */
export type AiConfigInput = DeepPartial<AiConfigShape>;

/**
 * Everything that is not a driver block.
 *
 * No driver appears here on purpose: `deepMerge` would then materialise that
 * driver for every app, and an app that only talks to Ollama would boot into
 * "drivers.anthropic.apiKey is empty" for a provider it never asked for.
 * Per-driver defaults are filled in by {@link applyDriverDefaults}, which runs
 * only over the blocks the app actually declared.
 */
const defaults: AiConfigShape = {
  default: "anthropic",
  drivers: {},
  embeddings: {
    default: "openai",
    drivers: {},
  },
  limits: {
    perRequestUsd: 0,
    perDayUsd: 0,
  },
  redact: true,
  agent: {
    lock: true,
    // Not "how long the agent might run" — that is unanswerable. It is how long
    // after a crash before another run may take over, and the loop refreshes it.
    lockTtl: 120,
    maxSteps: 25,
    maxResumes: 5,
  },
};

/**
 * Create a typed AI configuration object with defaults.
 *
 * @example
 * import { AiConfig } from '@zerotal/ai';
 *
 * export default AiConfig({
 *   default: 'anthropic',
 *   drivers: {
 *     anthropic: { apiKey: Bun.env['ANTHROPIC_API_KEY'] ?? '' },
 *     ollama:    { model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434' },
 *   },
 *   embeddings: {
 *     default: 'openai',
 *     drivers: {
 *       openai: { apiKey: Bun.env['OPENAI_API_KEY'] ?? '', model: 'text-embedding-3-small' },
 *     },
 *   },
 *   limits: { perRequestUsd: 0.5, perDayUsd: 25 },
 * });
 */
export function AiConfig(options: DeepPartial<AiConfigShape> = {}): AiConfigShape {
  const config = deepMerge(defaults, options as Partial<AiConfigShape>);
  applyDriverDefaults(config);
  validateAiConfig(config);
  return config;
}

/**
 * Fill in the per-driver defaults for drivers the app actually declared.
 *
 * They cannot live in `defaults` above: `deepMerge` would then materialise an
 * `openai` block for every app, and a config where every driver looks present
 * cannot tell "configured" from "left at its defaults".
 *
 * @internal
 */
function applyDriverDefaults(config: AiConfigShape): void {
  const { drivers, embeddings } = config;

  if (drivers.anthropic) {
    const given = drivers.anthropic as Partial<AnthropicConfigShape>;
    drivers.anthropic = {
      apiKey: given.apiKey ?? "",
      // Exact model id, no date suffix. Never construct one.
      model: given.model ?? "claude-opus-5",
      // max_tokens caps thinking *plus* response text, and thinking is on by
      // default on this model — a budget sized for the answer alone truncates.
      maxTokens: given.maxTokens ?? 16000,
      // Streaming has no HTTP-timeout ceiling to respect, so give it room.
      streamMaxTokens: given.streamMaxTokens ?? 64000,
      effort: given.effort ?? "high",
      fallbacks: given.fallbacks ?? true,
      cacheSystem: given.cacheSystem ?? true,
      timeout: given.timeout ?? 600_000,
      ...(given.baseUrl !== undefined ? { baseUrl: given.baseUrl } : {}),
      ...(given.temperature !== undefined ? { temperature: given.temperature } : {}),
    };
  }

  if (drivers.openai) {
    const given = drivers.openai as Partial<OpenAiConfigShape>;
    drivers.openai = {
      apiKey: given.apiKey ?? "",
      model: given.model ?? "gpt-4o-mini",
      maxTokens: given.maxTokens ?? 16000,
      baseUrl: given.baseUrl ?? "https://api.openai.com/v1",
      timeout: given.timeout ?? 600_000,
    };
  }

  if (drivers.ollama) {
    const given = drivers.ollama as Partial<OllamaConfigShape>;
    drivers.ollama = {
      model: given.model ?? "llama3.2",
      baseUrl: given.baseUrl ?? "http://127.0.0.1:11434",
      timeout: given.timeout ?? 600_000,
    };
  }

  if (embeddings.drivers.openai) {
    const given = embeddings.drivers.openai as Partial<EmbeddingsConfigShape["drivers"]["openai"]>;
    embeddings.drivers.openai = {
      apiKey: given?.apiKey ?? "",
      model: given?.model ?? "text-embedding-3-small",
      baseUrl: given?.baseUrl ?? "https://api.openai.com/v1",
      timeout: given?.timeout ?? 120_000,
    };
  }

  if (embeddings.drivers.ollama) {
    const given = embeddings.drivers.ollama as Partial<EmbeddingsConfigShape["drivers"]["ollama"]>;
    embeddings.drivers.ollama = {
      model: given?.model ?? "nomic-embed-text",
      baseUrl: given?.baseUrl ?? "http://127.0.0.1:11434",
      timeout: given?.timeout ?? 120_000,
    };
  }
}

/**
 * The zero-config fallback: an Anthropic driver built from `ANTHROPIC_API_KEY`.
 *
 * Used when an app registers {@link AiProvider} without a `config/ai.ts`, which
 * is the "installed it, exported the key, want to try it" path. With no key set
 * it produces an empty driver list, so {@link validateAiConfig} raises the
 * actionable error at boot rather than letting the first prompt fail.
 *
 * @example
 * // bootstrap/providers.ts registers AiProvider; no config file needed:
 * //   ANTHROPIC_API_KEY=sk-ant-… bun zt serve
 */
export function AiConfigFromEnv(): AiConfigShape {
  const apiKey = Bun.env["ANTHROPIC_API_KEY"] ?? "";
  return AiConfig(apiKey ? { drivers: { anthropic: { apiKey } } } : {});
}

/**
 * Check the config for combinations that would only fail at generation time.
 *
 * A default driver with no block, or an API key left empty in production, is a
 * deployment mistake — and the cheapest place to notice one is at boot, naming
 * the key, rather than on the first user's first prompt.
 *
 * @throws {AiConfigError} on the first inconsistency found.
 *
 * @internal
 */
export function validateAiConfig(config: AiConfigShape): void {
  const { drivers, embeddings, limits, agent } = config;

  const configured = Object.keys(drivers).filter(
    (name) => drivers[name as keyof typeof drivers] !== undefined,
  );

  if (configured.length === 0) {
    throw new AiConfigError(
      "No AI drivers are configured. Add at least one under drivers in config/ai.ts.",
    );
  }

  if (!configured.includes(config.default)) {
    throw new AiConfigError(
      `default is '${config.default}' but that driver has no block. Configured: ${configured.join(", ")}.`,
      { default: config.default, configured },
    );
  }

  if (drivers.anthropic) {
    const a = drivers.anthropic;
    if (!a.apiKey) {
      throw new AiConfigError(
        "drivers.anthropic.apiKey is empty. Set ANTHROPIC_API_KEY, or remove the anthropic block.",
      );
    }
    if (/-\d{8}$/.test(a.model)) {
      throw new AiConfigError(
        `drivers.anthropic.model '${a.model}' carries a date suffix. Use the exact alias — e.g. 'claude-opus-5'.`,
        { model: a.model },
      );
    }
    if (a.streamMaxTokens < a.maxTokens) {
      throw new AiConfigError(
        "drivers.anthropic.streamMaxTokens is below maxTokens. Streaming exists to lift the ceiling, not lower it.",
        { maxTokens: a.maxTokens, streamMaxTokens: a.streamMaxTokens },
      );
    }
    if (a.temperature !== undefined && modelRejectsSampling(a.model)) {
      // A warning rather than a throw: the driver drops it and the request still
      // succeeds. Throwing would break an app whose config merely carries a
      // leftover from a model that accepted it.
      console.warn(
        `[Zerotal/ai] drivers.anthropic.temperature is set, but ${a.model} rejects temperature/top_p/top_k ` +
          `with a 400. The driver drops it. Use effort ('low' … 'max') to trade thoroughness for cost instead.`,
      );
    }
  }

  if (drivers.openai && !drivers.openai.apiKey) {
    throw new AiConfigError(
      "drivers.openai.apiKey is empty. Set OPENAI_API_KEY, or remove the openai block.",
    );
  }

  const embedDrivers = Object.keys(embeddings.drivers).filter(
    (name) => embeddings.drivers[name as keyof typeof embeddings.drivers] !== undefined,
  );
  if (embedDrivers.length > 0 && !embedDrivers.includes(embeddings.default)) {
    throw new AiConfigError(
      `embeddings.default is '${embeddings.default}' but that driver has no block. Configured: ${embedDrivers.join(", ")}.`,
      { default: embeddings.default, configured: embedDrivers },
    );
  }
  if (embeddings.drivers.openai && !embeddings.drivers.openai.apiKey) {
    throw new AiConfigError("embeddings.drivers.openai.apiKey is empty. Set OPENAI_API_KEY.");
  }

  if (limits.perRequestUsd < 0 || limits.perDayUsd < 0) {
    throw new AiConfigError("limits must not be negative. Use 0 to disable a ceiling.");
  }
  if (limits.perDayUsd > 0 && limits.perRequestUsd > limits.perDayUsd) {
    throw new AiConfigError(
      "limits.perRequestUsd exceeds limits.perDayUsd — the per-request ceiling could never be reached.",
      { ...limits },
    );
  }

  if (agent.maxSteps < 1) {
    throw new AiConfigError("agent.maxSteps must be at least 1.");
  }
  if (agent.lockTtl < 1) {
    throw new AiConfigError("agent.lockTtl must be at least 1 second.");
  }
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    ai: AiConfigShape;
  }
}
