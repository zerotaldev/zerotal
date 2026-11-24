import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "../lib/cn";

/**
 * What a list shows before it has anything in it: what the thing is, and the one
 * action that fills it. An empty table with no explanation reads as broken.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>> | undefined;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="grid size-12 place-items-center rounded-xl border border-border bg-accent text-accent-foreground">
          <Icon className="size-6" />
        </div>
      ) : null}
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
