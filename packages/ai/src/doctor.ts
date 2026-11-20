/**
 * `zt doctor` checks this package contributes.
 *
 * Every one of them is a thing that fails by doing nothing, which is the kind a check exists for.
 */
import type { DoctorCheck } from "@zerotal/core";
import type { AiManager } from "./AiManager.ts";
import { _loadAnthropicSdk } from "./drivers/AnthropicDriver.ts";
import { AiDriverUnavailableError } from "./errors.ts";
import { modelPrice } from "./pricing.ts";

/**
 * The anthropic driver runs on `@anthropic-ai/sdk`, an optional peer, so an app that configures
 * the driver without installing the SDK boots cleanly and fails on its first request. This loads
 * the SDK the way the driver does and says which it is before that request.
 *
 * @internal The check with its loader passed in, so a test can stand in for a missing SDK.
 *   Apps get {@link aiProviderSdkCheck}.
 * @param load - Loads the SDK, throwing {@link AiDriverUnavailableError} when it is missing.
 */
export function _providerSdkCheck(load: () => Promise<unknown>): DoctorCheck {
  return {
    id: "ai-provider-sdk",
    label: "AI provider SDK",
    async run(app) {
      const ai = app.container.tryMake("ai") as AiManager | undefined;
      if (!ai) return { status: "ok", message: "AI is not registered." };
      if (!ai.config.drivers.anthropic) {
        return { status: "ok", message: "no configured driver needs a provider SDK." };
      }

      try {
        await load();
        return { status: "ok", message: "@anthropic-ai/sdk is installed." };
      } catch (error) {
        if (error instanceof AiDriverUnavailableError) {
          return {
            status: "fail",
            message:
              "drivers.anthropic is configured, but @anthropic-ai/sdk is not installed, so every " +
              "request to it fails.",
            fix: "bun add @anthropic-ai/sdk",
          };
        }
        // Installed but not loadable: the SDK threw, or one of its own dependencies is missing.
        return {
          status: "fail",
          message: `@anthropic-ai/sdk is installed but did not load: ${error instanceof Error ? error.message : String(error)}`,
          fix: "Reinstall dependencies: rm -rf node_modules && bun install",
        };
      }
    },
  };
}

/** Whether the configured anthropic driver has its SDK installed. */
export const aiProviderSdkCheck: DoctorCheck = _providerSdkCheck(_loadAnthropicSdk);

/**
 * A hosted model with no price costs $0 as far as this package can tell, and $0 turns both spend
 * ceilings off for it. The first request to such a model logs a warning, but a deploy that has
 * made no request yet reads clean, and a spend panel that says $0.00 looks like a quiet day.
 * Reading the configured models settles it before the first request.
 *
 * Ollama models are not checked: a local model costs nothing, and $0 is the right price.
 */
export const aiPriceCheck: DoctorCheck = {
  id: "ai-model-price",
  label: "AI model prices",
  run(app) {
    const ai = app.container.tryMake("ai") as AiManager | undefined;
    if (!ai) return { status: "ok", message: "AI is not registered." };

    const { drivers, limits } = ai.config;
    const models = [drivers.anthropic?.model, drivers.openai?.model].filter(
      (model): model is string => Boolean(model),
    );
    if (models.length === 0) return { status: "ok", message: "no hosted model is configured." };

    const unpriced = models.filter((model) => !modelPrice(model));
    if (unpriced.length === 0) return { status: "ok", message: `${models.join(", ")} priced.` };

    const ceilings = limits.perRequestUsd > 0 || limits.perDayUsd > 0;
    return {
      status: "warn",
      message:
        `${unpriced.join(", ")} has no price, so its spend is recorded as $0` +
        (ceilings
          ? " and the spend ceilings (limits.perRequestUsd, limits.perDayUsd) do not apply to it."
          : "."),
      fix: unpriced
        .map(
          (model) => `registerModelPrice("${model}", { input, output }) // USD per million tokens`,
        )
        .join("\n"),
    };
  },
};
