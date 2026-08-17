import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * The app's surface primitive — white on the page's off-white ground, with a
 * hairline border and no shadow.
 *
 * The tonal step between `--card` and `--background` is what separates a card
 * from the page, so a shadow would be saying the same thing twice. `interactive`
 * adds the hover treatment for cards that are themselves links: the border
 * darkens and a very slight shadow appears, which is enough of an affordance
 * without moving anything.
 */
export function Card({
  className,
  interactive = false,
  ...rest
}: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card",
        interactive &&
          "transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/30 hover:shadow-sm",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * The heading block inside a card: a title, and optionally a line saying what
 * the card is for.
 *
 * Same title/description relationship as {@link PageHeader}, one step down the
 * type scale — which is what makes a settings page read as a single document
 * rather than a stack of unrelated panels.
 */
export function CardHeader({
  title,
  description,
  className,
  ...rest
}: Omit<ComponentProps<"div">, "title"> & { title: string; description?: string }) {
  return (
    <div className={cn(className)} {...rest}>
      <h2 className="text-[0.9375rem] font-semibold text-card-foreground">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Small square glyph holder used at the top of a feature card. */
export function CardIcon({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid size-9 place-items-center rounded-md border border-border bg-muted text-muted-foreground",
        className,
      )}
      {...rest}
    />
  );
}
