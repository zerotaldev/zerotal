import type { Application, ArgDef, FlagDef } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { AiManager } from "../AiManager.ts";
import { modelPrice } from "../pricing.ts";

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

  static flags: FlagDef[] = [
    {
      name: "all",
      type: "boolean",
      description: "Test every configured driver, not only the default",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const ai = app.container.makeSync("ai") as AiManager;
    const requested = this.args["driver"];
    // The default driver, unless one is named or `--all` is passed. An app that declares a local
    // fallback (Ollama, say) next to its real provider would otherwise get a red line, and a
    // failing exit, on every run of a correct setup.
    const names = requested ? [requested] : this.flags["all"] ? ai.drivers() : [ai.config.default];

    if (names.length === 0 || (!requested && ai.drivers().length === 0)) {
      this.error("No AI drivers are configured. Add one under drivers in config/ai.ts.");
      process.exitCode = 1;
      return;
    }

    let failed = false;
    const models: string[] = [];

    for (const name of names) {
      this.line(`${name}: contacting the provider…`);
      const status = await ai.verify(name);

      if (status.ok) {
        models.push(status.model);
        this.info(`${name}: ok · model ${status.model} · ${status.detail}`);
      } else {
        failed = true;
        // A script or CI step that runs this to check a key must be able to tell.
        process.exitCode = 1;
        this.error(`${name}: failed · model ${status.model} · ${status.detail}`);
      }
    }

    // What a model costs is as much a part of the configuration as which model it is, and an
    // unpriced one turns the spend ceilings off. This is where a person looks.
    for (const model of new Set(models)) {
      const price = modelPrice(model);
      if (price) {
        this.line(`${model}: priced at $${price.input}/$${price.output} per million tokens`);
      } else {
        this.warn(
          `${model}: no price, so the spend ceilings do not apply to it. Add one with registerModelPrice().`,
        );
      }
    }

    if (!requested && !this.flags["all"] && ai.drivers().length > 1) {
      const others = ai.drivers().filter((name) => !names.includes(name));
      this.line(`Not tested: ${others.join(", ")}. Pass --all to test every driver.`);
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
