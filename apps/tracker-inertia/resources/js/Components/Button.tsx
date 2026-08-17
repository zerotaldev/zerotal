import { Link } from "@inertiajs/react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * The app's button styles, in one place.
 *
 * `Button` renders a `<button>`; `ButtonLink` renders an Inertia `<Link>` with
 * identical styling, so a nav action and a form submit can't drift apart. Both
 * are built from {@link buttonClass}, which you can also apply to a bare `<a>`
 * for an external link — that is what keeps the public page's calls to action
 * and the dashboard's buttons the same object.
 *
 * There is one scale for the whole app and it tops out at 40px. A button is a
 * control, not a banner.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap " +
  "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-input bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-4 text-sm",
  // Square, for a control whose whole label is its glyph. Pair with aria-label.
  icon: "size-9",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...rest
}: StyleProps & ComponentProps<"button">) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

// `size` is omitted from the Link props on purpose: Inertia's Link inherits the
// HTML `size` attribute (a number), which would intersect with this component's
// size scale and collapse the prop to `never`.
export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: StyleProps & Omit<ComponentProps<typeof Link>, "size">) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
