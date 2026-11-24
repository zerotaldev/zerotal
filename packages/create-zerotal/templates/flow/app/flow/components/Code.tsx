import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";

/** Inline code chip — for file paths, package names and commands used in prose. */
export function Code({
  class: className,
  children,
}: {
  class?: string | undefined;
  children?: unknown;
}): HtmlNode {
  return (
    <code
      class={cn(
        "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
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
    <div
      class={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-muted px-3.5 py-2.5 font-mono text-sm",
        className,
      )}
    >
      <span aria-hidden="true" class="text-primary select-none">
        $
      </span>
      <span class="overflow-x-auto text-foreground">{children}</span>
    </div>
  );
}
