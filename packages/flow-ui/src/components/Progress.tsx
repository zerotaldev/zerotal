/** @jsxImportSource @zerotal/flow */
// ── <Progress> ──────────────────────────────────────────────────────────────
//
// A determinate progress bar — for work where the remaining amount is known.
//
// `value` and `max` are reported to assistive technology through the ARIA
// progressbar role, so the bar is not merely decorative. Omitting `value` gives
// the indeterminate form, which is the honest rendering for "started, no idea
// how far" and is why it animates rather than sitting at zero.
//
//   <Progress value={imported} max={total} />
//   <Progress />                              {/* indeterminate */}

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ProgressProps {
  /** Completed amount. Omit for the indeterminate bar. */
  value?: number | undefined;
  max?: number;
  /** Show the percentage beside the bar. */
  showValue?: boolean;
  /** Describes what is progressing, for screen readers. */
  label?: string;
  /** Classes for the track. */
  class?: string;
  /** Classes for the filled portion. */
  barClass?: string;
  [key: string]: unknown;
}

export function Progress(props: ProgressProps): HtmlNode {
  const { value, max = 100, showValue, label, class: cls, barClass, ...rest } = props;

  const indeterminate = value == null || !Number.isFinite(value);
  // Clamped, because a caller reporting 7 of 5 should still render a full bar
  // rather than one that overflows its track.
  const percent = indeterminate ? 0 : Math.max(0, Math.min(100, (value / (max || 1)) * 100));

  return (
    <div class="flex items-center gap-3" {...rest}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        {...(indeterminate ? {} : { "aria-valuenow": Math.round(value) })}
        {...(label ? { "aria-label": label } : {})}
        class={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", cls)}
      >
        <div
          class={cn(
            "h-full rounded-full bg-primary transition-[width] duration-300 ease-out",
            // With no known total, a repeating sweep says "working" without
            // claiming an amount it cannot know.
            indeterminate && "w-1/3 animate-[flow-progress_1.2s_ease-in-out_infinite]",
            barClass,
          )}
          {...(indeterminate ? {} : { style: `width:${percent}%` })}
        />
      </div>
      {showValue && !indeterminate ? (
        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
          {Math.round(percent)}%
        </span>
      ) : null}
    </div>
  );
}
