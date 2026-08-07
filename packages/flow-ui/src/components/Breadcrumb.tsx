/** @jsxImportSource @zerotal/flow */
// ── <Breadcrumb> ────────────────────────────────────────────────────────────
//
// The trail showing where a page sits and how to get back up it.
//
// Takes a list of items rather than composed children, because a trail is data —
// it is nearly always derived from a route, a resource and a record, and building
// it as markup means every caller re-writes the same separator and aria wiring.
// The last item is the current page: it renders as text, not a link, and carries
// `aria-current="page"`, which is the part hand-rolled trails usually miss.
//
//   <Breadcrumb items={[
//     { label: "Dashboard", href: "/admin" },
//     { label: "Products", href: "/admin/products" },
//     { label: "Desk Lamp" },
//   ]} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface BreadcrumbItem {
  label: unknown;
  /** Omit on the last item — the page you are on is not a link to itself. */
  href?: string | undefined;
  /** Optional glyph before the label. */
  icon?: unknown;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** What sits between items. Defaults to a chevron. */
  separator?: unknown;
  /**
   * Collapse a long trail to first + last few with an ellipsis.
   * A trail deeper than this wraps onto two lines and stops being scannable.
   */
  maxItems?: number;
  class?: string;
  [key: string]: unknown;
}

const DEFAULT_SEPARATOR = (
  <svg
    class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/**
 * Shorten a long trail, keeping the root and the tail.
 *
 * The root and the immediate ancestors are what people navigate by; the middle
 * of a deep trail is the part nobody clicks. `null` marks the elision.
 */
function collapse(items: BreadcrumbItem[], maxItems: number): (BreadcrumbItem | null)[] {
  if (items.length <= maxItems) return items;
  const tail = items.slice(-(maxItems - 1));
  return [items[0]!, null, ...tail];
}

export function Breadcrumb(props: BreadcrumbProps): HtmlNode {
  const { items, separator = DEFAULT_SEPARATOR, maxItems, class: cls, ...rest } = props;
  const shown = maxItems && maxItems >= 2 ? collapse(items, maxItems) : items;

  return (
    <nav aria-label="Breadcrumb" class={cn("text-xs text-muted-foreground", cls)} {...rest}>
      <ol class="flex flex-wrap items-center gap-1.5">
        {shown.map((item, i) => (
          <li class="inline-flex items-center gap-1.5">
            {i > 0 ? separator : null}
            {item === null ? (
              <span aria-hidden="true">…</span>
            ) : item.href ? (
              <a
                href={item.href}
                navigate
                class="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                {item.icon}
                {item.label}
              </a>
            ) : (
              <span aria-current="page" class="inline-flex items-center gap-1 text-foreground">
                {item.icon}
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
