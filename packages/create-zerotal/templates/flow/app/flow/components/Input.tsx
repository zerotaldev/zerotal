import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { INPUT, TEXTAREA } from "../lib/ui";

/**
 * Bare form controls, styled. Reach for these where a label lives elsewhere — a search
 * box, a table filter. For a labelled control with its error wired up, use the `*Field`
 * components in Field.tsx, which wrap these.
 */

type ControlProps = { class?: string | undefined; [attribute: string]: unknown };

export function Input({ class: className, ...rest }: ControlProps): HtmlNode {
  return <input class={cn(INPUT, className)} {...rest} />;
}

export function Textarea({ class: className, rows = "5", ...rest }: ControlProps): HtmlNode {
  return <textarea rows={rows} class={cn(TEXTAREA, className)} {...rest} />;
}
