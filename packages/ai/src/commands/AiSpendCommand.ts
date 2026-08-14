import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { AiManager } from "../AiManager.ts";
import { modelStats } from "../stats.ts";
import { spentToday } from "../spend.ts";

/**
 * `zt ai:spend` — what this process has spent today, by model.
 *
 * Deliberately process-scoped, and says so: the ledger is in-memory, so N
 * workers hold N of these. It answers "what is *this* process doing" during
 * development and incident response; the provider's dashboard remains the
 * authority on the bill.
 *
 * @internal
 */
export class AiSpendCommand extends Command {
  static commandName = "ai:spend";
  static description = "Show this process's AI token spend today, by model";
  static needsApp = true;

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const ai = app.container.makeSync("ai") as AiManager;
    const models = modelStats();
    const spent = spentToday();

    this.line(`Spend today (this process): $${spent.toFixed(4)}`);
    if (ai.config.limits.perDayUsd > 0) {
      const share = ((spent / ai.config.limits.perDayUsd) * 100).toFixed(1);
      this.line(`Ceiling: $${ai.config.limits.perDayUsd.toFixed(2)} (${share}% used)`);
    }

    if (models.length === 0) {
      this.line("");
      this.line("No generations recorded in this process yet.");
      return;
    }

    this.line("");
    for (const model of models) {
      const cost = model.costUsd > 0 ? `$${model.costUsd.toFixed(4)}` : "unpriced";
      this.line(
        `  ${model.model.padEnd(24)} ${String(model.calls).padStart(5)} calls  ` +
          `${String(model.inputTokens).padStart(8)} in  ` +
          `${String(model.outputTokens).padStart(8)} out  ${cost}`,
      );
    }

    this.line("");
    this.line("Estimated from public list prices — an account with negotiated rates pays less.");
  }
}
