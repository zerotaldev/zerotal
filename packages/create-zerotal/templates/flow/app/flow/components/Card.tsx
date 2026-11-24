import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import {
  CARD,
  CARD_ACTIONS,
  CARD_BODY,
  CARD_DESCRIPTION,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_ICON,
  CARD_INTERACTIVE,
  CARD_TITLE,
} from "../lib/ui";

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
    <div class={cn(interactive ? CARD_INTERACTIVE : CARD, className)} {...rest}>
      {children}
    </div>
  );
}

/** Small square glyph holder used at the top of a feature card. */
export function CardIcon({ class: className, children }: BoxProps): HtmlNode {
  return <div class={cn(CARD_ICON, className)}>{children}</div>;
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
    <div class={cn(CARD_HEADER, className)}>
      <div class="min-w-0">
        <h2 class={CARD_TITLE}>{title}</h2>
        {description ? <p class={CARD_DESCRIPTION}>{description}</p> : null}
      </div>
      {actions ? <div class={CARD_ACTIONS}>{actions}</div> : null}
    </div>
  );
}

/** The padded body under a {@link CardHeader}. */
export function CardBody({ class: className, children }: BoxProps): HtmlNode {
  return <div class={cn(CARD_BODY, className)}>{children}</div>;
}

/** A tinted strip along the bottom of a card, for the form's submit button. */
export function CardFooter({ class: className, children }: BoxProps): HtmlNode {
  return <div class={cn(CARD_FOOTER, className)}>{children}</div>;
}
