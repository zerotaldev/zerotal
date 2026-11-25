import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { MODAL, MODAL_CLOSE, MODAL_FOOTER } from "../lib/ui";

/**
 * A dialog over the page, built on the native `<dialog>` element.
 *
 * `showModal()` gives the parts that are easy to get wrong for free: focus moves into the
 * dialog and is kept there, the rest of the page is inert to the keyboard and to screen
 * readers, and Escape closes it. Clicking the backdrop closes it too.
 *
 * Opened by any button with `data-open-modal="<id>"`; anything inside with
 * `data-close-modal` closes it. resources/js/lib/modals.ts does the wiring.
 */
export function Modal({
  id,
  title,
  description,
  children,
  footer,
  class: className,
}: {
  id: string;
  title: unknown;
  description?: unknown;
  children?: unknown;
  /** Buttons along the bottom, right-aligned. */
  footer?: unknown;
  class?: string | undefined;
}): HtmlNode {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <dialog
      id={id}
      data-modal=""
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      class={cn(MODAL, className)}
    >
      <div class="p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <h2 id={titleId} class="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" data-close-modal="" aria-label="Close" class={MODAL_CLOSE}>
            <Icon name="close" class="size-4.5" />
          </button>
        </div>
        {description ? (
          <p id={descriptionId} class="mt-1.5 text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children ? <div class="mt-5">{children}</div> : null}
      </div>
      {footer ? <div class={MODAL_FOOTER}>{footer}</div> : null}
    </dialog>
  );
}
