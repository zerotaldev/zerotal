/** @jsxImportSource @zerotal/flow */
// ── <HoverCard> ─────────────────────────────────────────────────────────────
//
// A preview panel that appears on hover — a user card behind a mention, an order
// summary behind a reference.
//
// The difference from <Tooltip> is what goes in it: a tooltip holds a short
// label and nothing interactive, a hover card holds content you might want to
// click. That is why this opens on a delay, stays open while the pointer travels
// toward it, and is reachable by keyboard focus — a tooltip needs none of that
// because there is nothing in it to reach.
//
// The open delay is not decoration. Without it, sweeping the pointer across a
// table of links flashes a card over every one of them.
//
//   <HoverCard trigger={<a href="/users/1">@ada</a>}>
//     <p class="text-sm font-medium">Ada Mokoena</p>
//   </HoverCard>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface HoverCardProps {
  /** What is hovered. */
  trigger?: unknown;
  /** Milliseconds before it opens. */
  openDelay?: number;
  /** Milliseconds before it closes, giving the pointer time to reach the panel. */
  closeDelay?: number;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function HoverCard(props: HoverCardProps): HtmlNode {
  const {
    trigger,
    openDelay = 300,
    closeDelay = 150,
    side = "bottom",
    align = "start",
    class: cls,
    children,
    ...rest
  } = props;

  // One timer for both directions: a re-entry must cancel a pending close, or
  // moving from trigger to panel closes the card halfway there.
  const state = `{
    open: false,
    t: null,
    show() { clearTimeout(this.t); this.t = setTimeout(() => (this.open = true), ${openDelay}); },
    hide() { clearTimeout(this.t); this.t = setTimeout(() => (this.open = false), ${closeDelay}); }
  }`;

  return (
    <div
      x-data={state}
      class="relative inline-block"
      x-on:mouseenter="show()"
      x-on:mouseleave="hide()"
      {...rest}
    >
      <span
        tabindex={0}
        x-on:focus="open = true"
        x-on:blur="hide()"
        class="cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
      >
        {trigger}
      </span>
      <div
        x-show="open"
        x-cloak
        x-transition
        class={cn(
          "absolute z-50 w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          cls,
        )}
      >
        {children}
      </div>
    </div>
  );
}
