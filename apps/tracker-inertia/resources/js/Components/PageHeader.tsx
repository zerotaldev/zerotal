import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The title block every page in the app opens with.
 *
 * One component rather than a heading typed out per page, because "every screen
 * starts the same way" is a promise that only holds if there is one place to
 * break it. The scale is deliberately modest — 24px, the same as a section
 * heading elsewhere in the industry's dashboards. A page inside an application
 * does not need to introduce itself at hero size; the reader already chose to be
 * here.
 *
 * `actions` sits on the title's baseline on wide screens and wraps beneath the
 * description on narrow ones.
 */
export default function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        {/* Wraps rather than truncates: an issue title is the page's whole
            subject, and half of one is not a saving worth making. */}
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
