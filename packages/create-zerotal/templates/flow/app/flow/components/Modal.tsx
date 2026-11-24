import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

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
      class={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl",
        "backdrop:bg-black/50 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div class="p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <h2 id={titleId} class="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            data-close-modal=""
            aria-label="Close"
            class="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
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
      {footer ? (
        <div class="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
