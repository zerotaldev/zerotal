/** @jsxImportSource @zerotal/flow */
// ── <Empty> ─────────────────────────────────────────────────────────────────
//
// The state a list is in before it has anything in it. Worth a component because
// the bad version — the word "None" in a table cell — is the default that happens
// when nobody decides otherwise, and it leaves the reader unsure whether the
// screen is empty, broken, or filtered down to nothing.
//
// A good empty state says which of those it is and offers the next step, so the
// action slot is part of the component rather than something to remember.
//
//   <Empty icon={<Icon name="inbox" />} title="No orders yet"
//          description="Orders appear here as customers place them."
//          action={<Button>New order</Button>} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface EmptyProps {
  /** Decorative glyph above the heading. */
  icon?: unknown;
  title?: unknown;
  description?: unknown;
  /** What to do about it — usually a button or two. */
  action?: unknown;
  /**
   * Render without the dashed border, for an empty state already inside a card
   * or a panel that draws its own edge.
   */
  bare?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Empty(props: EmptyProps): HtmlNode {
  const { icon, title, description, action, bare, class: cls, children, ...rest } = props;
  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        !bare && "rounded-lg border border-dashed border-border",
        cls,
      )}
      {...rest}
    >
      {icon ? (
        <div class="mb-3 flex h-10 w-10 items-center justify-center text-muted-foreground">
          {icon}
        </div>
      ) : null}
      {title ? <p class="text-sm font-medium text-foreground">{title}</p> : null}
      {description ? (
        <p class="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children}
      {action ? <div class="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
