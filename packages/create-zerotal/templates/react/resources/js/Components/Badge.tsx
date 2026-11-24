import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/25 bg-accent text-accent-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

/** A short status label — a project's status, "This device", "Enabled". */
export function Badge({
  tone = "neutral",
  className,
  ...rest
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}
