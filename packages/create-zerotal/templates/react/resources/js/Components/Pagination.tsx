import { Link } from "@inertiajs/react";
import { cn } from "../lib/cn";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icon";
import type { Pagination as PaginationData } from "../types";

/**
 * "Showing 11–20 of 42", with previous / next. `href` builds the URL for a page, so the
 * list keeps its other query parameters (a search, a filter) as the user pages through.
 */
export function Pagination({
  pagination,
  href,
  noun = "results",
}: {
  pagination: PaginationData;
  href: (page: number) => string;
  noun?: string | undefined;
}) {
  const { page, lastPage, total, from, to } = pagination;
  if (total === 0) return null;

  const link = (target: number, label: string, disabled: boolean, icon: "prev" | "next") => {
    const className = cn(
      "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors",
      disabled ? "pointer-events-none opacity-50" : "bg-card hover:bg-muted",
    );
    const content =
      icon === "prev" ? (
        <>
          <ChevronLeftIcon className="size-4" /> {label}
        </>
      ) : (
        <>
          {label} <ChevronRightIcon className="size-4" />
        </>
      );
    return disabled ? (
      <span aria-disabled="true" className={className}>
        {content}
      </span>
    ) : (
      <Link href={href(target)} preserveScroll className={className} rel={icon}>
        {content}
      </Link>
    );
  };

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span> {noun}
      </p>
      {lastPage > 1 ? (
        <div className="flex gap-2">
          {link(page - 1, "Previous", page <= 1, "prev")}
          {link(page + 1, "Next", page >= lastPage, "next")}
        </div>
      ) : null}
    </nav>
  );
}
