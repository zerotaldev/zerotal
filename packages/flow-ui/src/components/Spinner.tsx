/** @jsxImportSource @zerotal/flow */
// ── <Spinner> ───────────────────────────────────────────────────────────────
//
// A rotating indicator for work whose duration is unknown. When the duration IS
// known — an import that has done 40 of 200 rows — use <Progress> instead; a
// spinner tells someone to wait, a bar tells them how long.
//
// Renders an SVG rather than a bordered div so it stays circular at any size and
// inherits `currentColor`, which means it looks right inside a button without
// being told what colour the button is.
//
//   <Spinner />
//   <Button disabled><Spinner size="sm" /> Saving…</Button>

import type { HtmlNode } from "@zerotal/flow";
import { gva } from "../utils/gva.ts";

export const spinnerVariants = gva("animate-spin text-current", {
  variants: {
    size: {
      sm: "h-3.5 w-3.5",
      default: "h-5 w-5",
      lg: "h-8 w-8",
    },
  },
  defaultVariants: { size: "default" },
});

export interface SpinnerProps {
  size?: "sm" | "default" | "lg";
  /** Announced to screen readers. Pass `null` inside a container that already says it. */
  label?: string | null;
  class?: string;
  [key: string]: unknown;
}

export function Spinner(props: SpinnerProps): HtmlNode {
  const { size, label = "Loading", class: cls, ...rest } = props;
  return (
    <span role="status" class="inline-flex items-center" {...rest}>
      <svg
        class={spinnerVariants({ size, class: cls })}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {/* The faint ring is the track; the arc is what reads as motion. */}
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
        <path
          d="M22 12a10 10 0 0 1-10 10"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
        />
      </svg>
      {label ? <span class="sr-only">{label}</span> : null}
    </span>
  );
}
