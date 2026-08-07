/** @jsxImportSource @zerotal/flow */
// ── <ScrollArea> ────────────────────────────────────────────────────────────
//
// A scrollable region with a consistent scrollbar.
//
// Deliberately native overflow with a styled scrollbar, not a JavaScript
// replacement that hides the real one and draws its own. Custom scrollbars break
// keyboard scrolling, momentum on touch, and the browser's own find-on-page — a
// steep price for matching a design on one platform. Styling the native bar gets
// most of the appearance for none of that.
//
// The fade at the edges is the other half: it tells someone there is more to see,
// which a thin scrollbar on a trackpad does not.
//
//   <ScrollArea class="h-72">…long list…</ScrollArea>
//   <ScrollArea orientation="horizontal">…wide table…</ScrollArea>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ScrollAreaProps {
  orientation?: "vertical" | "horizontal" | "both";
  /** Fade the content at the scrollable edges. */
  fade?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Scrollbar styling for both engines.
 *
 * `scrollbar-*` is the standard property Firefox implements; the `::-webkit-`
 * pseudo-elements cover the rest. Both are set because neither is universal yet,
 * and a region styled in only one looks unfinished in the other.
 */
const SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] " +
  "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 " +
  "[&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border " +
  "[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40";

const OVERFLOW: Record<NonNullable<ScrollAreaProps["orientation"]>, string> = {
  vertical: "overflow-y-auto overflow-x-hidden",
  horizontal: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

export function ScrollArea(props: ScrollAreaProps): HtmlNode {
  const { orientation = "vertical", fade, class: cls, children, ...rest } = props;

  const region = (
    <div
      class={cn("relative", OVERFLOW[orientation], SCROLLBAR, !fade && cls)}
      {...(fade ? {} : rest)}
    >
      {children}
    </div>
  );

  if (!fade) return region;

  return (
    <div class={cn("relative", cls)} {...rest}>
      {region}
      {/* Pointer-events off, so the fade never eats a click on what it covers. */}
      {orientation !== "horizontal" ? (
        <>
          <div class="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-background to-transparent" />
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-background to-transparent" />
        </>
      ) : (
        <>
          <div class="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-background to-transparent" />
          <div class="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-background to-transparent" />
        </>
      )}
    </div>
  );
}
