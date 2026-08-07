import { Command } from "../Command.ts";
import { buildCssBundle } from "../../dev/CssPlugins.ts";

/**
 * `bun zt css:build` — builds the Tailwind CSS bundle for production.
 *
 * Used by Pulse and View apps (Inertia uses `inertia:build` instead).
 *
 * Input:  resources/css/app.css
 * Output: public/css/app.css
 *
 * @category Build & assets
 */
export class CssBuildCommand extends Command {
  static commandName = "css:build";
  static description = "Build the Tailwind CSS bundle for production";
  static needsApp = false;

  static flags = [
    {
      name: "input",
      short: "i",
      type: "string" as const,
      description: "Path to the CSS entry point",
      default: "resources/css/app.css",
    },
    {
      name: "output",
      short: "o",
      type: "string" as const,
      description: "Output directory",
      default: "public/css",
    },
    {
      name: "minify",
      short: "m",
      type: "boolean" as const,
      description: "Minify the output",
      default: true,
    },
  ];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const input = this.flags["input"] as string;
    const output = this.flags["output"] as string;
    const minify = this.flags["minify"] as boolean;

    const absoluteInput = input.startsWith("/") ? input : `${cwd}/${input}`;
    const absoluteOutput = output.startsWith("/") ? output : `${cwd}/${output}`;

    const cssExists = await Bun.file(absoluteInput).exists();
    if (!cssExists) {
      this.error(`CSS entry point not found: ${input}`);
      return;
    }

    this.info(`Building CSS: ${input} → ${output}/`);

    const result = await buildCssBundle(absoluteInput, absoluteOutput, minify);

    if (!result.success) {
      for (const log of result.logs) {
        this.error(String(log));
      }
      throw new Error("CSS build failed.");
    }

    this.info("CSS build complete.");
  }
}
