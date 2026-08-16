import { Link } from "@inertiajs/react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * The app's button styles, in one place.
 *
 * `Button` renders a `<button>`; `ButtonLink` renders an Inertia `<Link>` with
 * identical styling, so a nav action and a form submit can't drift apart. Both
 * are built from {@link buttonClass}, which you can also apply to a bare `<a>`
 * for an external link.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,color,transform] duration-150 " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[0.95rem]",
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
