import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** Inline code chip — for file paths, package names and commands used in prose. */
export function Code({ className, ...rest }: ComponentProps<"code">) {
  return (
    <code
      className={cn(
        "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

/** A terminal-styled block for a command the reader is meant to run. */
export function Command({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-muted px-3.5 py-2.5 font-mono text-sm",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="text-primary select-none">
        $
      </span>
      <span className="overflow-x-auto text-foreground">{children}</span>
    </div>
  );
}
