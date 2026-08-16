import type { ComponentProps } from "react";
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
