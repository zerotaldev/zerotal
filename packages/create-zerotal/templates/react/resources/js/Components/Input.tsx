import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * Bare form controls, styled. Reach for these where a label lives elsewhere — a search
 * box, a table filter. For a labelled control with its error wired up, use the
 * `*Field` components in Field.tsx, which wrap these.
 */

/** The look every text-like control shares, so an input and a select line up. */
export const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-xs " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Border colour for a control, red when it failed validation. */
export function controlBorder(invalid: boolean): string {
  return invalid ? "border-destructive" : "border-input";
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return (
    <input
      className={cn(CONTROL, controlBorder(rest["aria-invalid"] === true), className)}
      {...rest}
    />
  );
}

export function Textarea({ className, rows = 5, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL, "resize-y", controlBorder(rest["aria-invalid"] === true), className)}
      {...rest}
    />
  );
}
