import type { HtmlNode } from "@zerotal/flow";
import { ICONS, type IconName } from "../lib/icons";

/**
 * The icons this starter needs, inlined: `<Icon name="folder" class="size-4" />`.
 *
 * One component with a `name`, drawn from lib/icons.ts — the same glyphs as the React
 * and Vue starters. Outline icons inherit `currentColor`, so they follow the theme with
 * no extra wiring; the two brand marks (GitHub, Google) carry their own fill. Reach for a
 * real icon set once you outgrow these.
 */
export function Icon({ name, class: className }: { name: IconName; class?: string }): HtmlNode {
  const icon = ICONS[name];
  // The markup is this file's own constants, never user input.
  return icon.brand ? (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      class={className}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
