import type { HtmlNode } from "@zerotal/flow";
import type { IconName } from "../lib/icons";
import { icon } from "../lib/ui";

/**
 * The icons this starter needs, inlined: `<Icon name="folder" class="size-4" />`.
 *
 * One component with a `name`, drawn from lib/icons.ts — the same glyphs as the React
 * and Vue starters. Outline icons inherit `currentColor`, so they follow the theme with
 * no extra wiring; the two brand marks (GitHub, Google) carry their own fill. Reach for a
 * real icon set once you outgrow these.
 */
export function Icon({ name, class: className }: { name: IconName; class?: string }): HtmlNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      class={className}
      dangerouslySetInnerHTML={icon(name)}
    />
  );
}
