/** @jsxImportSource @zerotal/flow */
// ── <Icon> ──────────────────────────────────────────────────────────────────
//
// An icon by name, from the set bundled with this package:
//
//   <Icon name="inbox" />
//   <Icon name="trash-2" class="size-5 text-red-600" />
//   <button><Icon name="trash-2" label="Delete order" /></button>
//
// Nothing to install and nothing to configure — 2,060 names ship here, and the
// name is a union, so a typo is a compile error rather than a blank space nobody
// notices until it is in front of a user. See `icons/registry.ts` for how an app
// adds its own, and `scripts/sync-icons.ts` for where the set comes from.
//
// Rendered on the server as inline SVG: no icon font, no client bundle, no request
// per glyph, and nothing for a strict CSP to block.

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";
import { resolveIcon } from "../icons/loader.ts";
import type { IconName } from "../icons/registry.ts";

export interface IconProps {
  /** Which icon — e.g. `inbox`, `trash-2`, `chevron-right`. */
  name: IconName;
  /**
   * Accessible label. Omit it for decoration — the default — and the icon is
   * hidden from assistive technology instead of being announced as noise beside
   * the text it decorates.
   *
   * An icon that is the *only* content of a control is **not** decoration: a
   * button holding nothing but a trash glyph has no accessible name without this.
   */
  label?: string;
  class?: string;
  [key: string]: unknown;
}

/**
 * Render an icon from the bundled set.
 *
 * Sized in `em` and coloured by `currentColor`, so an icon inherits the text it
 * sits in and `class="size-5 text-red-600"` is how it stops doing that. Sizing
 * through CSS rather than `width`/`height` attributes is what lets it line up with
 * a label without either being measured.
 *
 * A name that resolves to nothing renders **nothing**. An icon is decoration far
 * more often than it is content, and taking a page down over a missing glyph is
 * the worse failure — the union above is what makes that case rare enough to
 * treat quietly.
 */
export function Icon(props: IconProps): HtmlNode {
  const { name, label, class: cls, ...rest } = props;

  const icon = resolveIcon(name);
  if (!icon) return { html: "" };

  // Announced or hidden — never neither. An unlabelled `role="img"` is a element
  // a screen reader stops at with nothing to say.
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${icon.width} ${icon.height}`}
      width="1em"
      height="1em"
      // No `fill` here on purpose. Lucide is a stroke set whose bodies carry
      // `fill="none" stroke="currentColor"` themselves; forcing a fill on the
      // wrapper would paint solid blobs over every outline in the set.
      class={cn("inline-block shrink-0", cls)}
      {...a11y}
      {...rest}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
