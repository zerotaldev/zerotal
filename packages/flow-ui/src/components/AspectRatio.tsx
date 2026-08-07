/** @jsxImportSource @zerotal/flow */
// ── <AspectRatio> ───────────────────────────────────────────────────────────
//
// Holds a fixed width-to-height ratio for whatever is inside it — a video
// embed, a cover image, a map.
//
// The point is reserving the space before the content arrives. A grid of cards
// whose images each snap to their natural size as they load reflows the whole
// page underneath the reader; a ratio box means the layout is final from the
// first paint.
//
//   <AspectRatio ratio={16 / 9}><img src={cover} class="h-full w-full object-cover" /></AspectRatio>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface AspectRatioProps {
  /** Width ÷ height. `16 / 9` for video, `1` for a square. */
  ratio?: number;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function AspectRatio(props: AspectRatioProps): HtmlNode {
  const { ratio = 1, class: cls, children, ...rest } = props;
  return (
    <div
      // The CSS property rather than the padding-top trick: it is supported
      // everywhere now, and it does not require the child to be positioned.
      style={`aspect-ratio:${ratio}`}
      class={cn("relative w-full overflow-hidden", cls)}
      {...rest}
    >
      {children}
    </div>
  );
}
