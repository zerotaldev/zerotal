import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { CODE, COMMAND } from "../lib/ui";

/** Inline code chip — for file paths, package names and commands used in prose. */
export function Code({
  class: className,
  children,
}: {
  class?: string | undefined;
  children?: unknown;
}): HtmlNode {
  return <code class={cn(CODE, className)}>{children}</code>;
}

/** A terminal-styled block for a command the reader is meant to run. */
export function Command({
  class: className,
  children,
}: {
  class?: string | undefined;
  children?: unknown;
}): HtmlNode {
  return (
    <div class={cn(COMMAND, className)}>
      <span aria-hidden="true" class="text-primary select-none">
        $
      </span>
      <span class="overflow-x-auto text-foreground">{children}</span>
    </div>
  );
}
