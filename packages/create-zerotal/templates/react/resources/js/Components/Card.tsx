import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The app's surface primitive — a hairline border with a faint inner highlight
 * (see the `surface` utility in resources/css/app.css) instead of a drop shadow.
 *
 * Pass `interactive` for cards that are links or buttons: it adds a hover lift
 * and a border tint so the affordance is obvious without a shadow.
 */
export function Card({
  className,
  interactive = false,
  ...rest
}: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "surface rounded-xl",
        interactive &&
          "transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40",
        className,
      )}
      {...rest}
    />
  );
}

/** Small square glyph holder used at the top of a feature card. */
export function CardIcon({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid size-10 place-items-center rounded-lg border border-border bg-accent text-accent-foreground",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * A titled section of a card — the shape every settings panel takes. `actions` sits to
 * the right of the title on wide screens and below it on narrow ones.
 */
export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-card-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The padded body under a {@link CardHeader}. */
export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-5 sm:px-6", className)} {...rest} />;
}

/** A tinted strip along the bottom of a card, for the form's submit button. */
export function CardFooter({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-border bg-muted/40 px-5 py-3 sm:px-6",
        className,
      )}
      {...rest}
    />
  );
}
