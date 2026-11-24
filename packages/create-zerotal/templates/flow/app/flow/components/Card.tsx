import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";

type BoxProps = { class?: string | undefined; children?: unknown; [attribute: string]: unknown };

/**
 * The app's surface primitive — a hairline border with a faint inner highlight (see the
 * `surface` utility in resources/css/app.css) instead of a drop shadow.
 *
 * Pass `interactive` for cards that are links or buttons: it adds a hover lift and a
 * border tint so the affordance is obvious without a shadow.
 */
export function Card({
  class: className,
  interactive = false,
  children,
  ...rest
}: BoxProps & { interactive?: boolean }): HtmlNode {
  return (
    <div
      class={cn(
        "surface rounded-xl",
        interactive &&
          "transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Small square glyph holder used at the top of a feature card. */
export function CardIcon({ class: className, children }: BoxProps): HtmlNode {
  return (
    <div
      class={cn(
        "grid size-10 place-items-center rounded-lg border border-border bg-accent text-accent-foreground",
        className,
      )}
    >
      {children}
    </div>
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
  class: className,
}: {
  title: unknown;
  description?: unknown;
  actions?: unknown;
  class?: string | undefined;
}): HtmlNode {
  return (
    <div
      class={cn(
        "flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6",
        className,
      )}
    >
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-card-foreground">{title}</h2>
        {description ? <p class="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div class="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The padded body under a {@link CardHeader}. */
export function CardBody({ class: className, children }: BoxProps): HtmlNode {
  return <div class={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

/** A tinted strip along the bottom of a card, for the form's submit button. */
export function CardFooter({ class: className, children }: BoxProps): HtmlNode {
  return (
    <div
      class={cn(
        "flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-border bg-muted/40 px-5 py-3 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
