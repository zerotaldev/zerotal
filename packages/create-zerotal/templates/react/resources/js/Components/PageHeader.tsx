import { Link } from "@inertiajs/react";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./Icons";

/** The title row at the top of a signed-in page: what this is, and what you can do here. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A link back up a level, shown above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8">
      {back ? (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1.5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
