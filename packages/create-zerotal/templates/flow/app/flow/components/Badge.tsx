import type { HtmlNode } from "@zerotal/flow";
import { badgeClass, type BadgeTone } from "../lib/ui";

export type { BadgeTone };

/** A short status label — a project's status, "This device", "Enabled". */
export function Badge({
  tone = "neutral",
  class: className,
  children,
}: {
  tone?: BadgeTone;
  class?: string | undefined;
  children?: unknown;
}): HtmlNode {
  return <span class={badgeClass(tone, className)}>{children}</span>;
}
