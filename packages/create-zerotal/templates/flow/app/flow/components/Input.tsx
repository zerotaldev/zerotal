import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";

/**
 * Bare form controls, styled. Reach for these where a label lives elsewhere — a search
 * box, a table filter. For a labelled control with its error wired up, use the `*Field`
 * components in Field.tsx, which wrap these.
 */

/** The look every text-like control shares, so an input and a select line up. */
export const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-xs " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

/** Border colour for a control. A failed one turns red through `aria-invalid`. */
export const CONTROL_BORDER = "border-input";

type ControlProps = { class?: string | undefined; [attribute: string]: unknown };

export function Input({ class: className, ...rest }: ControlProps): HtmlNode {
  return <input class={cn(CONTROL, CONTROL_BORDER, className)} {...rest} />;
}

export function Textarea({ class: className, rows = "5", ...rest }: ControlProps): HtmlNode {
  return (
    <textarea rows={rows} class={cn(CONTROL, CONTROL_BORDER, "resize-y", className)} {...rest} />
  );
}
