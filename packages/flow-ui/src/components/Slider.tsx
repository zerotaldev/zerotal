/** @jsxImportSource @zerotal/flow */
// ── <Slider> ────────────────────────────────────────────────────────────────
//
// A value chosen from a range. Wraps the headless slider, so the value, the
// filled track and the readout all follow the thumb on the client at frame rate,
// and the bound `@expose` prop is written once the drag settles.
//
// That split is the point. A slider whose readout is rendered by the server
// shows a number that does not move while you drag it, which reads as broken
// even when the eventual value is right. Dragging is a pointer interaction, so
// it belongs entirely to the client; only the outcome is worth a round-trip.
//
// The control underneath is a native `<input type="range">`, so keyboard, touch
// and screen-reader support come from the platform rather than being rebuilt.
//
//   <Slider bind={this.volume} min={0} max={100} showValue />
//   <Slider bind={this.price} max={500} step={5} format="'R' + value" />

import type { HtmlNode } from "@zerotal/flow";
import { Slider as HeadlessSlider } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SliderProps {
  /** Bound @expose number — `this.volume`. */
  bind?: unknown;
  name?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Show the live value beside the track. */
  showValue?: boolean;
  /**
   * Format the readout — a price, a percentage.
   *
   * A client-side expression rather than a function, because the readout has to
   * change while the thumb moves and a server-side formatter cannot run then.
   * The live number is in scope as `value`, e.g. `format="'R' + value"`.
   */
  format?: string;
  disabled?: boolean;
  class?: string;
  [key: string]: unknown;
}

/**
 * Track and thumb styling, applied through the vendor pseudo-elements.
 *
 * Both prefixes are listed separately and cannot be merged into one selector: a
 * browser drops an entire rule when any selector in it is unknown, so a shared
 * comma-separated list would leave neither engine styling the thumb.
 */
const TRACK =
  "h-2 w-full cursor-pointer appearance-none rounded-full outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none " +
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 " +
  "[&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background " +
  "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition-transform " +
  "[&::-webkit-slider-thumb]:hover:scale-110 " +
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full " +
  "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary " +
  "[&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow";

/** The track gradient for a known value, so the first paint is already filled. */
function fill(value: unknown, min: number, max: number): string {
  const n = typeof value === "number" ? value : min;
  const percent = Math.min(100, Math.max(0, ((n - min) / (max - min || 1)) * 100));
  return `background:linear-gradient(to right, var(--primary) ${percent}%, var(--secondary) ${percent}%)`;
}

export function Slider(props: SliderProps): HtmlNode {
  const {
    bind,
    name,
    min = 0,
    max = 100,
    step = 1,
    showValue,
    format,
    disabled,
    class: cls,
    ...rest
  } = props;

  return (
    <HeadlessSlider
      {...rest}
      {...(bind !== undefined ? { bind } : {})}
      {...(name ? { name } : {})}
      min={min}
      max={max}
      step={step}
      class="flex items-center gap-3"
      inputClass={cn(TRACK, cls)}
      {...(disabled ? { disabled: true } : {})}
      // The filled portion is a gradient on the track itself rather than a
      // second element behind it — one box to style, and nothing to keep
      // aligned. Rendered server-side for the first paint, then re-bound by
      // Alpine so it tracks the thumb rather than the last saved value.
      inputStyle={fill(bind, min, max)}
      inputStyleExpression="`background:linear-gradient(to right, var(--primary) ${percent()}%, var(--secondary) ${percent()}%)`"
    >
      {showValue ? (
        <span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {/* The server prints the raw number so the box is never empty; the
              formatted version arrives with Alpine and then tracks the drag. */}
          <span {...{ "x-text": format ?? "value" }}>
            {typeof bind === "number" ? String(bind) : ""}
          </span>
        </span>
      ) : null}
    </HeadlessSlider>
  );
}
