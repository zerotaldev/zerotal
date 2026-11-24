import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE: Record<AlertTone, string> = {
  info: "border-border bg-muted/50 text-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const ICON: Record<AlertTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
};

/**
 * A message that belongs to the page rather than to the moment — "verify your email",
 * "two-factor is on". For "saved" and other one-off confirmations, flash a toast.
 *
 * `danger` and `warning` are announced to screen readers as they appear; the others are
 * read in document order like any other text.
 */
export function Alert({
  tone = "info",
  title,
  children,
  actions,
  class: className,
}: {
  tone?: AlertTone | undefined;
  title?: unknown;
  children?: unknown;
  actions?: unknown;
  class?: string | undefined;
}): HtmlNode {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : undefined}
      class={cn("flex gap-3 rounded-xl border p-4", TONE[tone], className)}
    >
      <Icon name={ICON[tone]} class="mt-0.5 size-5 shrink-0" />
      <div class="min-w-0 flex-1 text-sm">
        {title ? <p class="font-semibold">{title}</p> : null}
        {children ? (
          <div class={cn("text-foreground/80", title ? "mt-1" : undefined)}>{children}</div>
        ) : null}
        {actions ? <div class="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
