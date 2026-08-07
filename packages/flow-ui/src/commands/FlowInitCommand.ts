import { Command } from "@zerotal/core";
import { join } from "node:path";
import { DEFAULT_UI_DIR, ensureUtils, missingRuntimeDeps } from "./support.ts";

const THEME_IMPORT = `@import "@zerotal/flow-ui/theme.css";`;

/**
 * One-time setup for flow-ui in an app: drops the shared `cn`/`gva` utils into
 * `app/flow/components/ui/lib/` and wires the design-token theme into the app's
 * Tailwind entry CSS. Idempotent — safe to re-run.
 *
 * @example
 *   bun zt flow:init
 */
export class FlowInitCommand extends Command {
  static override commandName = "flow:init";
  static override description = "Set up flow-ui (utils + theme import) in this app";
  static override needsApp = false;
  static override flags = [
    {
      name: "dir",
      type: "string" as const,
      description: "Target UI directory",
      default: DEFAULT_UI_DIR,
    },
    {
      name: "css",
      type: "string" as const,
      description: "Tailwind entry CSS",
      default: "resources/css/app.css",
    },
  ];

  async run(): Promise<void> {
    const uiDir = (this.flags["dir"] as string) || DEFAULT_UI_DIR;
    const cssPath = (this.flags["css"] as string) || "resources/css/app.css";

    // 1 · Shared utils.
    const utils = await ensureUtils(uiDir);
    if (utils.length) {
      for (const target of utils) this.info(`+ ${join(uiDir, target)}`);
    } else {
      this.dim(`utils already present in ${uiDir.replace(/\\/g, "/")}/lib`);
    }

    // 2 · Theme import into the Tailwind entry CSS.
    const cssFile = Bun.file(cssPath);
    if (await cssFile.exists()) {
      const css = await cssFile.text();
      if (css.includes("@zerotal/flow-ui/theme.css")) {
        this.dim(`theme already imported in ${cssPath}`);
      } else {
        // Insert right after the `@import "tailwindcss";` line (tokens need Tailwind first).
        const next = css.includes(`@import "tailwindcss";`)
          ? css.replace(`@import "tailwindcss";`, `@import "tailwindcss";\n${THEME_IMPORT}`)
          : `${THEME_IMPORT}\n${css}`;
        await Bun.write(cssPath, next);
        this.info(`+ theme import added to ${cssPath}`);
      }
    } else {
      this.warn(`${cssPath} not found — add this line to your Tailwind CSS yourself:`);
      this.dim(`  ${THEME_IMPORT}`);
    }

    // 3 · Runtime deps the copied `cn` util needs.
    const missing = missingRuntimeDeps();
    if (missing.length) {
      this.newLine();
      this.warn("Install the utils' runtime deps:");
      this.dim(`  bun add ${missing.join(" ")}`);
    }

    this.newLine();
    this.line("flow-ui is ready.");
    this.dim("Add components with:  bun zt flow:add button,card  (or flow:list to browse)");
  }
}
