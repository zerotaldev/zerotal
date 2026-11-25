import type { HtmlNode } from "@zerotal/flow";
import {
  ALERT_BODY,
  ALERT_ICON,
  ALERT_ICON_CLASS,
  ALERT_TEXT,
  ALERT_TEXT_UNDER_TITLE,
  ALERT_TITLE,
  alertClass,
  alertRole,
  type AlertTone,
} from "../lib/ui";
import { Icon } from "./Icon";

export type { AlertTone };

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
    <div role={alertRole(tone)} class={alertClass(tone, className)}>
      <Icon name={ALERT_ICON[tone]} class={ALERT_ICON_CLASS} />
      <div class={ALERT_BODY}>
        {title ? <p class={ALERT_TITLE}>{title}</p> : null}
        {children ? (
          <div class={title ? ALERT_TEXT_UNDER_TITLE : ALERT_TEXT}>{children}</div>
        ) : null}
        {actions ? <div class="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
