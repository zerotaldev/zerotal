import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

/** One page of a list, and where it sits in the whole. */
export interface PaginationData {
  page: number;
  lastPage: number;
  total: number;
  from: number | null;
  to: number | null;
}

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
}): HtmlNode {
  const { page, lastPage, total, from, to } = pagination;
  if (total === 0) return { html: "" };

  const link = (target: number, label: string, disabled: boolean, icon: "prev" | "next") => {
    const className = cn(
      "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors",
      disabled ? "pointer-events-none opacity-50" : "bg-card hover:bg-muted",
    );
    const content =
      icon === "prev" ? (
        <>
          <Icon name="chevron-left" class="size-4" /> {label}
        </>
      ) : (
        <>
          {label} <Icon name="chevron-right" class="size-4" />
        </>
      );
    return disabled ? (
      <span aria-disabled="true" class={className}>
        {content}
      </span>
    ) : (
      <a href={href(target)} class={className} rel={icon}>
        {content}
      </a>
    );
  };

  return (
    <nav aria-label="Pagination" class="flex items-center justify-between gap-4">
      <p class="text-sm text-muted-foreground">
        Showing <span class="font-medium text-foreground">{from}</span>–
        <span class="font-medium text-foreground">{to}</span> of{" "}
        <span class="font-medium text-foreground">{total}</span> {noun}
      </p>
      {lastPage > 1 ? (
        <div class="flex gap-2">
          {link(page - 1, "Previous", page <= 1, "prev")}
          {link(page + 1, "Next", page >= lastPage, "next")}
        </div>
      ) : null}
    </nav>
  );
}
