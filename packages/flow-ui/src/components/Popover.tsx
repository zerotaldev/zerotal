/** @jsxImportSource @zerotal/flow */
// ── <Popover> ───────────────────────────────────────────────────────────────
//
// A themed floating panel anchored to a trigger. Wraps the headless popover, so
// the open/close state, click-outside, Escape and `aria-expanded` are already
// handled — this adds the surface (bg-popover, border, shadow) and the placement.
//
// The trigger is whatever you pass as `trigger`; give it a <Button> and it looks
// like a button, give it text and it does not. The panel is plain children, which
// is what makes this the base for the date picker, the combobox and the hover card
// rather than a component that only holds one kind of content.
//
//   <Popover trigger={<Button variant="outline">Options</Button>}>
//     <p class="text-sm">Anything at all.</p>
//   </Popover>

import type { HtmlNode } from "@zerotal/flow";
import { Popover as HeadlessPopover } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export type PopoverAlign = "start" | "center" | "end";
export type PopoverSide = "top" | "right" | "bottom" | "left";

export interface PopoverProps {
  /** The element that opens the panel. */
  trigger?: unknown;
  /** Text for a default button trigger, when `trigger` is not given. */
  label?: unknown;
  /** Which edge the panel sits on. Defaults to below the trigger. */
  side?: PopoverSide;
  /** How the panel lines up along that edge. */
  align?: PopoverAlign;
  /** Classes for the panel surface. */
  class?: string;
  /** Classes for the trigger wrapper. */
  triggerClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Absolute placement per side and alignment.
 *
 * Positioned with plain CSS rather than a floating-element library: a panel that
 * flips itself when it would overflow is genuinely useful, but it costs a
 * measurement pass and a client dependency, and the overwhelming majority of
 * popovers in a back office open downward with room to spare. Pass `side` for
 * the ones that do not.
 */
const SIDE: Record<PopoverSide, string> = {
  bottom: "top-full mt-2",
  top: "bottom-full mb-2",
  right: "left-full ml-2 top-0",
  left: "right-full mr-2 top-0",
};

const ALIGN: Record<PopoverSide, Record<PopoverAlign, string>> = {
  bottom: { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" },
  top: { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" },
  right: { start: "top-0", center: "top-1/2 -translate-y-1/2", end: "bottom-0 top-auto" },
  left: { start: "top-0", center: "top-1/2 -translate-y-1/2", end: "bottom-0 top-auto" },
};

/** The panel surface, shared with the components built on this one. */
export const popoverSurface =
  "z-50 min-w-[8rem] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none";

export function Popover(props: PopoverProps): HtmlNode {
  const {
    trigger,
    label,
    side = "bottom",
    align = "start",
    class: cls,
    triggerClass,
    children,
    ...rest
  } = props;

  return (
    <HeadlessPopover
      {...rest}
      class={cn("relative inline-block", rest["wrapperClass"] as string)}
      buttonClass={cn("cursor-pointer outline-none", triggerClass)}
      panelClass={cn("absolute", SIDE[side], ALIGN[side][align], popoverSurface, cls)}
      {...(trigger ? { trigger } : {})}
      {...(label !== undefined ? { label } : {})}
    >
      {children}
    </HeadlessPopover>
  );
}
