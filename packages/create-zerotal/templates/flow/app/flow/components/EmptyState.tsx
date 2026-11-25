import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";
import { EMPTY_DESCRIPTION, EMPTY_ICON, EMPTY_STATE, EMPTY_TITLE } from "../lib/ui";

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
    <div class={cn(EMPTY_STATE, className)}>
      {icon ? (
        <div class={EMPTY_ICON}>
          <Icon name={icon} class="size-6" />
        </div>
      ) : null}
      <h3 class={EMPTY_TITLE}>{title}</h3>
      {description ? <p class={EMPTY_DESCRIPTION}>{description}</p> : null}
      {action ? <div class="mt-6">{action}</div> : null}
    </div>
  );
}
