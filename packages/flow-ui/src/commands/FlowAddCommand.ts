import { Command } from "@zerotal/core";
import { join } from "node:path";
import {
  COMPONENTS,
  findComponent,
  resolveSource,
  rewriteImports,
  withDependencies,
} from "../registry.ts";
import { DEFAULT_UI_DIR, copyText, ensureUtils, missingRuntimeDeps } from "./support.ts";

/**
 * Copy flow-ui component source into your app, so you own the code outright.
 * Files land in `app/flow/components/ui/`, with the shared `cn`/`gva` utils in
 * `ui/lib/`. Util imports are rewritten to the local `./lib/*` paths on the way in.
 *
 * @example
 *   bun zt flow:add button                 // one component
 *   bun zt flow:add button,card,dialog     // several (comma-separated)
 *   bun zt flow:add --all                  // everything
 *   bun zt flow:add button --force         // overwrite if it exists
 */
export class FlowAddCommand extends Command {
  static override commandName = "flow:add";
  static override description = "Copy flow-ui component(s) into your app";
  static override needsApp = false;
  static override args = [
    {
      name: "name",
      required: false,
      description: "Component id(s), comma-separated (e.g. button,card)",
    },
  ];
  static override flags = [
    { name: "all", type: "boolean" as const, description: "Add every component", default: false },
    {
      name: "force",
      short: "f",
      type: "boolean" as const,
      description: "Overwrite existing files",
      default: false,
    },
    {
      name: "dir",
      type: "string" as const,
      description: "Target UI directory",
      default: DEFAULT_UI_DIR,
    },
  ];

  async run(): Promise<void> {
    const all = this.flags["all"] as boolean;
    const force = this.flags["force"] as boolean;
    const uiDir = (this.flags["dir"] as string) || DEFAULT_UI_DIR;
    const raw = (this.args["name"] ?? "").trim();

    // Resolve the requested component list.
    const requested = all
      ? COMPONENTS.map((c) => c.name)
      : raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    if (requested.length === 0) {
      this.error("Name a component to add, e.g. `flow:add button` (or use --all).");
      this.dim("See everything available with:  bun zt flow:list");
      return;
    }

    // Validate up-front so a typo doesn't write a partial set.
    const unknown = requested.filter((n) => !findComponent(n));
    if (unknown.length > 0) {
      this.error(`Unknown component(s): ${unknown.join(", ")}`);
      this.dim("Run `bun zt flow:list` to see valid names.");
      return;
    }

    // A composed component is no use without the pieces it imports, so they come
    // along whether or not they were asked for.
    const names = withDependencies(requested);
    const pulled = names.filter((n) => !requested.includes(n));
    if (pulled.length > 0) {
      this.dim(`Also adding what these are built from: ${pulled.join(", ")}`);
    }

    // Shared utils first (cn, gva) — idempotent.
    const utils = await ensureUtils(uiDir);
    for (const target of utils) this.info(`+ ${join(uiDir, target)}`);

    let added = 0;
    let skipped = 0;
    for (const name of names) {
      const entry = findComponent(name)!;
      const dest = join(uiDir, entry.target);
      if (!force && (await Bun.file(dest).exists())) {
        this.warn(`• ${dest} already exists — skipped (use --force to overwrite)`);
        skipped++;
        continue;
      }
      await copyText(resolveSource(entry.source), dest, rewriteImports);
      this.info(`+ ${dest}`);
      added++;
    }

    this.newLine();
    this.line(`Done — ${added} added${skipped ? `, ${skipped} skipped` : ""}.`);
    if (added > 0) {
      const first = findComponent(requested[0]!)!;
      this.dim(
        `Import them from ${uiDir.replace(/\\/g, "/")}/ — e.g. { ${first.title} } from "./ui/${first.target.replace(/\.tsx?$/, "")}".`,
      );
    }
    this._warnMissingDeps();
  }

  /** The copied `cn` util needs clsx + tailwind-merge in the host app. */
  private _warnMissingDeps(): void {
    const missing = missingRuntimeDeps();
    if (missing.length === 0) return;
    this.newLine();
    this.warn(`These components need packages your app doesn't have yet:`);
    this.dim(`  bun add ${missing.join(" ")}`);
  }
}
