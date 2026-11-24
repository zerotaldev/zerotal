import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { CloseIcon } from "./Icon";

/**
 * A dialog over the page, built on the native `<dialog>` element.
 *
 * `showModal()` gives the parts that are easy to get wrong for free: focus moves into
 * the dialog and is kept there, the rest of the page is inert to the keyboard and to
 * screen readers, and Escape closes it. Clicking the backdrop closes it too.
 *
 * Controlled: render it with `open` and handle `onClose`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom, right-aligned. */
  footer?: ReactNode;
  className?: string | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape fires `cancel`; let the parent decide, so its state stays the truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl",
        "backdrop:bg-black/50 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </div>
        {description ? (
          <p id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-5">{children}</div> : null}
      </div>
      {footer ? (
        <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
