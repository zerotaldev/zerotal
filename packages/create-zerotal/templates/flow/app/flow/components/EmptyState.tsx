import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";

/**
 * What a list shows before it has anything in it: what the thing is, and the one action
 * that fills it. An empty table with no explanation reads as broken.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  class: className,
}: {
  icon?: IconName | undefined;
  title: unknown;
  description?: unknown;
  action?: unknown;
  class?: string | undefined;
}): HtmlNode {
  return (
    <div
      class={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div class="grid size-12 place-items-center rounded-xl border border-border bg-accent text-accent-foreground">
          <Icon name={icon} class="size-6" />
        </div>
      ) : null}
      <h3 class="mt-4 text-base font-semibold">{title}</h3>
      {description ? (
        <p class="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div class="mt-6">{action}</div> : null}
    </div>
  );
}
