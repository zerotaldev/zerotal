/** @jsxImportSource @zerotal/flow */
// ── <Pagination> ────────────────────────────────────────────────────────────
//
// Page links for a paginated list.
//
// Links, not buttons: a page is a place, so it should be shareable, openable in
// a new tab, and reachable by the back button. The caller supplies `href(page)`
// because only it knows which other query parameters — search, filters, sort —
// have to survive the jump.
//
// The window of numbers around the current page is computed rather than fixed,
// so page 97 of 400 shows 95…99 instead of 1…5 with the current page off-screen.
//
//   <Pagination page={p.page} lastPage={p.lastPage} href={(n) => `?page=${n}`} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface PaginationProps {
  /** Current page, 1-based. */
  page: number;
  lastPage: number;
  /** Build the URL for a page. */
  href: (page: number) => string;
  /**
   * How many numbered links to show around the current page. Odd numbers centre
   * the current page; even ones lean left.
   */
  siblings?: number;
  /** Total row count, shown as "1–20 of 431" when `perPage` is also given. */
  total?: number | undefined;
  perPage?: number | undefined;
  class?: string;
  [key: string]: unknown;
}

/**
 * The page numbers to draw, with `null` marking a gap.
 *
 * First and last are always present so the ends of the list stay one click away,
 * which is what people reach for far more often than page 96.
 */
export function paginationRange(page: number, lastPage: number, siblings = 5): (number | null)[] {
  if (lastPage <= siblings + 2) {
    return Array.from({ length: Math.max(lastPage, 0) }, (_, i) => i + 1);
  }

  const half = Math.floor(siblings / 2);
  // Clamped at both ends, so the window keeps its width near the start and finish
  // rather than shrinking to two links on page 1.
  let start = Math.max(2, page - half);
  const end = Math.min(lastPage - 1, start + siblings - 1);
  start = Math.max(2, Math.min(start, end - siblings + 1));

  const out: (number | null)[] = [1];
  if (start > 2) out.push(null);
  for (let n = start; n <= end; n++) out.push(n);
  if (end < lastPage - 1) out.push(null);
  out.push(lastPage);
  return out;
}

const linkBase =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors";

function Arrow({ dir }: { dir: "prev" | "next" }): HtmlNode {
  return (
    <svg
      class="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "prev" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

export function Pagination(props: PaginationProps): HtmlNode {
  const { page, lastPage, href, siblings = 5, total, perPage, class: cls, ...rest } = props;

  // One page is not worth a control; showing it only adds a disabled row.
  if (lastPage <= 1 && total == null) return <></>;

  const pages = paginationRange(page, lastPage, siblings);
  const from = perPage ? (page - 1) * perPage + 1 : null;
  const to = perPage && total != null ? Math.min(page * perPage, total) : null;

  return (
    <nav
      aria-label="Pagination"
      class={cn("flex flex-wrap items-center justify-between gap-3", cls)}
      {...rest}
    >
      {total != null && from != null ? (
        <p class="text-sm text-muted-foreground">
          {total === 0 ? "No results" : `${from}–${to} of ${total}`}
        </p>
      ) : (
        <span />
      )}

      {lastPage > 1 ? (
        <div class="flex items-center gap-1">
          {page > 1 ? (
            <a
              href={href(page - 1)}
              navigate
              aria-label="Previous page"
              class={cn(linkBase, "hover:bg-accent hover:text-accent-foreground")}
            >
              <Arrow dir="prev" />
            </a>
          ) : (
            // Rendered but inert, so the row does not shift when it appears.
            <span aria-hidden="true" class={cn(linkBase, "pointer-events-none opacity-40")}>
              <Arrow dir="prev" />
            </span>
          )}

          {pages.map((n) =>
            n === null ? (
              <span class="px-1 text-sm text-muted-foreground" aria-hidden="true">
                …
              </span>
            ) : n === page ? (
              <a
                href={href(n)}
                navigate
                aria-current="page"
                class={cn(linkBase, "bg-primary text-primary-foreground")}
              >
                {String(n)}
              </a>
            ) : (
              <a
                href={href(n)}
                navigate
                aria-label={`Page ${n}`}
                class={cn(linkBase, "hover:bg-accent hover:text-accent-foreground")}
              >
                {String(n)}
              </a>
            ),
          )}

          {page < lastPage ? (
            <a
              href={href(page + 1)}
              navigate
              aria-label="Next page"
              class={cn(linkBase, "hover:bg-accent hover:text-accent-foreground")}
            >
              <Arrow dir="next" />
            </a>
          ) : (
            <span aria-hidden="true" class={cn(linkBase, "pointer-events-none opacity-40")}>
              <Arrow dir="next" />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
