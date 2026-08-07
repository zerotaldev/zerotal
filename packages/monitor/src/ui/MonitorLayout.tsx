/** @jsxImportSource @zerotal/flow */
import { Layout } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { flowUiHead } from "@zerotal/flow-ui";

/**
 * The shell for the monitoring panel.
 *
 * The panel is built from `@zerotal/flow-ui` and themed with its design tokens,
 * so it inherits light/dark mode and stays visually consistent with everything
 * else Zerotal ships. The only thing the monitor overrides is `--primary`: the
 * panel's own orange, applied on top of the shared palette rather than baked
 * into its markup.
 *
 * Because every component reads `--primary` rather than a literal colour, that
 * one override recolours the whole panel — and an app can re-brand it further by
 * appending its own token CSS.
 */

/** The monitor's orange, layered over flow-ui's neutral palette. */
const MONITOR_TOKENS = `
:root {
  --primary: 21 90% 48%;
  --primary-foreground: 0 0% 100%;
  --ring: 21 90% 48%;
}
.dark {
  --primary: 25 95% 58%;
  --primary-foreground: 224 71% 4%;
  --ring: 25 95% 58%;
}
`.trim();

export class MonitorLayout extends Layout {
  static override get head(): string {
    return flowUiHead("Zerotal · Monitor", { tokensCss: MONITOR_TOKENS });
  }

  override render(slot: HtmlNode): HtmlNode {
    return <div class="h-screen bg-background text-foreground antialiased">{slot}</div>;
  }
}
