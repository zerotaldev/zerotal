// ── <Tooltip> ───────────────────────────────────────────────────────────────
//
// A themed tooltip. Built fresh over the same Alpine
// hover/focus logic as Flow's Tooltip, with a token-themed bubble and
// aria-describedby wiring.
//
//   <Tooltip content="Add to library"><Button size="icon">+</Button></Tooltip>

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface TooltipProps {
  /** The tooltip text/content. */
  content?: unknown;
  placement?: "top" | "bottom";
  class?: string;
  tooltipClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Tooltip(props: TooltipProps): HtmlNode {
  const { content, placement = "top", class: cls, tooltipClass, children, ...rest } = props;
  const pos = placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1";

  return jsx("span", {
    ...rest,
    "x-data": "{ open: false }",
    "x-id": "['flow-tooltip']",
    "x-on:mouseenter": "open = true",
    "x-on:mouseleave": "open = false",
    "x-on:focusin": "open = true",
    "x-on:focusout": "open = false",
    class: cn("relative inline-block", cls),
    children: [
      jsx("span", { ":aria-describedby": "$id('flow-tooltip')", tabindex: 0, children }),
      jsx("span", {
        role: "tooltip",
        ":id": "$id('flow-tooltip')",
        "x-show": "open",
        "x-cloak": true,
        "x-transition": true,
        class: cn(
          "absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md",
          pos,
          tooltipClass,
        ),
        children: content,
      }),
    ],
  });
}
