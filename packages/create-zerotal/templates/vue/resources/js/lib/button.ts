import { cn } from "./cn";

/**
 * The app's button styles, in one place. Components/Button.vue uses them, and so can a
 * bare `<a>` for a link that leaves the app.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,color,transform] duration-150 " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[0.95rem]",
  icon: "size-9",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

/** The look every text-like control shares, so an input and a select line up. */
export const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-xs " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Border colour for a control, red when it failed validation. */
export function controlBorder(invalid: boolean): string {
  return invalid ? "border-destructive" : "border-input";
}
