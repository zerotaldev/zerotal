import { env } from "zerotal";
import { AiConfig } from "@zerotal/ai";
import type { AiConfigInput } from "@zerotal/ai";

const anthropicKey = env("ANTHROPIC_API_KEY", "");

/**
 * The docs site's AI configuration.
 *
 * Anthropic when a key is present, Ollama otherwise — so a contributor with no
 * provider account can still boot the site and open `/showcase/flow/ai-chat`.
 * Ollama needs no key, so this config always validates; without a local server
 * running the demo shows the driver's own "is `ollama serve` running?" message,
 * which is the truthful answer rather than a fake one.
 *
 * The daily ceiling is deliberately small. This is a public demo page: the
 * failure mode worth guarding against is somebody discovering it and holding
 * down Enter.
 */
const drivers: NonNullable<AiConfigInput["drivers"]> = {
  ollama: { model: env("OLLAMA_MODEL", "llama3.2") },
};

if (anthropicKey) {
  drivers.anthropic = {
    apiKey: anthropicKey,
    model: env("ANTHROPIC_MODEL", "claude-opus-5"),
    // Short answers for a demo box — `effort`, never `temperature`, which
    // current Claude models reject with a 400.
    effort: "low",
  };
}

export default AiConfig({
  default: anthropicKey ? "anthropic" : "ollama",
  drivers,
  limits: { perRequestUsd: 0.05, perDayUsd: 2 },
});
