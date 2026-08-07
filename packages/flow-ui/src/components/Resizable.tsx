/** @jsxImportSource @zerotal/flow */
// ── <Resizable> ─────────────────────────────────────────────────────────────
//
// Two panes with a handle between them — a file tree beside an editor, a list
// beside a detail view.
//
// The handle is a real focusable control with arrow-key support, not a bare div
// with a mousedown listener. A split someone cannot adjust without a mouse is a
// split that is stuck for anyone who cannot use one, and it costs a `tabindex`
// and a key handler to fix.
//
// Sizes are percentages so the split survives a window resize, and are clamped
// by `min` so neither pane can be dragged out of existence.
//
//   <Resizable start={<Tree />} end={<Editor />} defaultSize={30} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ResizableProps {
  /** The first pane — left, or top when vertical. */
  start?: unknown;
  /** The second pane. */
  end?: unknown;
  orientation?: "horizontal" | "vertical";
  /** Starting size of the first pane, as a percentage. */
  defaultSize?: number;
  /** Smallest either pane may become, as a percentage. */
  min?: number;
  class?: string;
  [key: string]: unknown;
}

export function Resizable(props: ResizableProps): HtmlNode {
  const {
    start,
    end,
    orientation = "horizontal",
    defaultSize = 50,
    min = 10,
    class: cls,
    ...rest
  } = props;

  const horizontal = orientation === "horizontal";

  // Pointer events rather than mouse events, so a stylus and a touchscreen work
  // without a second code path. Capture keeps the drag alive when the pointer
  // outruns the handle, which it always does.
  const state = `{
    size: ${defaultSize},
    dragging: false,
    start(e) {
      this.dragging = true;
      e.target.setPointerCapture(e.pointerId);
    },
    move(e) {
      if (!this.dragging) return;
      const box = $el.getBoundingClientRect();
      const raw = ${
        horizontal
          ? "((e.clientX - box.left) / box.width) * 100"
          : "((e.clientY - box.top) / box.height) * 100"
      };
      this.size = Math.min(${100 - min}, Math.max(${min}, raw));
    },
    stop(e) {
      this.dragging = false;
      if (e.pointerId != null) e.target.releasePointerCapture?.(e.pointerId);
    },
    nudge(by) {
      this.size = Math.min(${100 - min}, Math.max(${min}, this.size + by));
    }
  }`.replace(/\s+/g, " ");

  return (
    <div
      x-data={state}
      {...{ "x-on:pointermove": "move($event)" }}
      {...{ "x-on:pointerup": "stop($event)" }}
      class={cn("flex w-full", horizontal ? "flex-row" : "flex-col", cls)}
      {...rest}
    >
      <div
        {...{
          "x-bind:style": horizontal ? "`flex-basis:${size}%`" : "`flex-basis:${size}%`",
        }}
        class="min-w-0 overflow-hidden"
      >
        {start}
      </div>

      <div
        role="separator"
        tabindex={0}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        {...{ "x-bind:aria-valuenow": "Math.round(size)" }}
        aria-valuemin={min}
        aria-valuemax={100 - min}
        aria-label="Resize panes"
        {...{ "x-on:pointerdown": "start($event)" }}
        {...{
          "x-on:keydown": horizontal
            ? "if ($event.key === 'ArrowLeft') { $event.preventDefault(); nudge(-2) } if ($event.key === 'ArrowRight') { $event.preventDefault(); nudge(2) }"
            : "if ($event.key === 'ArrowUp') { $event.preventDefault(); nudge(-2) } if ($event.key === 'ArrowDown') { $event.preventDefault(); nudge(2) }",
        }}
        {...{ "x-bind:class": "dragging && 'bg-primary'" }}
        class={cn(
          "group relative shrink-0 bg-border transition-colors hover:bg-primary/50",
          "outline-none focus-visible:bg-primary",
          horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        )}
      >
        {/* A one-pixel line is impossible to grab, so the hit area is widened
            invisibly around it rather than making the divider itself thicker. */}
        <span
          class={cn("absolute", horizontal ? "-inset-x-1.5 inset-y-0" : "-inset-y-1.5 inset-x-0")}
        />
      </div>

      <div class="min-w-0 flex-1 overflow-hidden">{end}</div>
    </div>
  );
}
