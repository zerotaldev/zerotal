import { Command } from "@zerotal/core";
import { COMPONENTS } from "../registry.ts";

/**
 * List every component available to `reno flow add`.
 *
 * @example
 *   bun zt flow:list
 */
export class FlowListCommand extends Command {
  static override commandName = "flow:list";
  static override description = "List the flow-ui components available to add";
  static override needsApp = false;

  async run(): Promise<void> {
    this.section(`flow-ui — ${COMPONENTS.length} components`);
    this.table(COMPONENTS.map((c) => [c.name, c.description]));
    this.newLine();
    this.dim("Add one with:  bun zt flow:add <name>[,<name>…]   (or --all)");
  }
}
