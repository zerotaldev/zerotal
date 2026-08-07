/** @jsxImportSource @zerotal/flow */
// ── <Separator> ─────────────────────────────────────────────────────────────
//
// A themed divider. Horizontal by default; pass
// `orientation="vertical"` for a vertical rule. Decorative by default (ARIA-hidden);
// pass `decorative={false}` to expose it as a semantic separator.
//
//   <Separator />
//   <Separator orientation="vertical" class="h-6" />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
  class?: string;
  [key: string]: unknown;
}

export function Separator(props: SeparatorProps): HtmlNode {
  const { orientation = "horizontal", decorative = true, class: cls, ...rest } = props;
  const a11y = decorative
    ? { role: "none" }
    : { role: "separator", "aria-orientation": orientation };
  return (
    <div
      {...a11y}
      class={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        cls,
      )}
      {...rest}
    />
  );
}
