import { Link } from "@inertiajs/react";
import { cn } from "../lib/cn";

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
  from: number | null;
  to: number | null;
}

/**
 * Pagination that keeps the rest of the query string.
 *
 * The page number is one filter among several, so a "next" link that dropped
 * `?status=todo` would silently widen the result set — the classic way page 2
 * shows rows page 1 excluded. Every link here is built from the current URL with
 * only `page` replaced.
 *
 * Rendered as real `<a>` elements through Inertia's `Link`, so the middle-click
 * and copy-link behaviour a list is expected to have still works.
 */
export default function Pagination({ meta, className }: { meta: PageMeta; className?: string }) {
  if (meta.lastPage <= 1) return null;

  const href = (page: number): string => {
    const url = new URL(window.location.href);
    if (page <= 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(page));
    return `${url.pathname}${url.search}`;
  };

  const pages = pageWindow(meta.page, meta.lastPage);
  const step = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm";

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between gap-4 px-4 py-3", className)}
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        {meta.from ?? 0}–{meta.to ?? 0} of {meta.total}
      </p>

      <div className="flex items-center gap-1">
        {meta.page > 1 ? (
          <Link href={href(meta.page - 1)} className={cn(step, "hover:bg-muted")} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cn(step, "text-muted-foreground/50")}>Previous</span>
        )}

        {pages.map((page, index) =>
          page === null ? (
            <span key={`gap-${index}`} className={cn(step, "text-muted-foreground")}>
              …
            </span>
          ) : (
            <Link
              key={page}
              href={href(page)}
              aria-current={page === meta.page ? "page" : undefined}
              className={cn(
                step,
                "tabular-nums",
                page === meta.page
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "hover:bg-muted",
              )}
            >
              {page}
            </Link>
          ),
        )}

        {meta.page < meta.lastPage ? (
          <Link href={href(meta.page + 1)} className={cn(step, "hover:bg-muted")} rel="next">
            Next
          </Link>
        ) : (
          <span className={cn(step, "text-muted-foreground/50")}>Next</span>
        )}
      </div>
    </nav>
  );
}

/**
 * Which page numbers to show: the ends, and a window around where you are.
 *
 * `null` is a gap. Capped so a hundred pages does not become a hundred links —
 * the seed only reaches two, but the component is shared with builds that will
 * page further.
 */
function pageWindow(current: number, last: number): Array<number | null> {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

  const out: Array<number | null> = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(last - 1, current + 1);

  if (from > 2) out.push(null);
  for (let page = from; page <= to; page++) out.push(page);
  if (to < last - 1) out.push(null);

  out.push(last);
  return out;
}
