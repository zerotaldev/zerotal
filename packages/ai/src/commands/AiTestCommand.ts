import type { Application, ArgDef } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { AiManager } from "../AiManager.ts";

/**
 * `zt ai:test [driver]` — reach the provider once and print what came back.
 *
 * AI configuration fails in ways unit tests cannot reach: a key with no access
 * to the model, a model id that 404s because someone appended a date suffix, a
 * gateway that rewrites the base URL. This exercises the whole path and prints
 * the resolved model — which is the value people most often assume rather than
 * check.
 *
 * @internal
 */
export class AiTestCommand extends Command {
  static commandName = "ai:test";
  static description = "Verify AI credentials and print the resolved model";
  static needsApp = true;

  static args: ArgDef[] = [{ name: "driver", required: false }];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const ai = app.container.makeSync("ai") as AiManager;
    const requested = this.args["driver"];
    const names = requested ? [requested] : ai.drivers();

    if (names.length === 0) {
      this.error("No AI drivers are configured. Add one under drivers in config/ai.ts.");
      return;
    }

    let failed = false;

    for (const name of names) {
      this.line(`${name}: contacting the provider…`);
      const status = await ai.verify(name);

      if (status.ok) {
        this.info(`${name}: ok · model ${status.model} · ${status.detail}`);
      } else {
        failed = true;
        this.error(`${name}: failed · model ${status.model} · ${status.detail}`);
      }
    }

    if (!failed) {
      this.line("");
      this.line(`Default driver: ${ai.config.default}`);
      if (ai.config.limits.perDayUsd > 0) {
        this.line(`Daily spend ceiling: $${ai.config.limits.perDayUsd.toFixed(2)}`);
      }
    }
  }
}
