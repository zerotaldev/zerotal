/** @jsxImportSource @zerotal/flow */
// ── <Accordion> ─────────────────────────────────────────────────────────────
//
// Stacked sections where opening one reveals its content. Wraps the headless
// accordion, which already handles the open state, `aria-expanded` and the
// button/panel association — this supplies the surface, the dividers and the
// chevron that turns.
//
// Single-open by default. `multiple` lets several stay open at once, which suits
// a settings page (each section is independent) but not an FAQ (where one answer
// at a time is the point).
//
//   <Accordion items={[
//     { label: "Shipping", content: <p>Ships in 2–3 days.</p> },
//     { label: "Returns", content: <p>30 days, no questions.</p> },
//   ]} />

import type { HtmlNode } from "@zerotal/flow";
import { Accordion as HeadlessAccordion } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface AccordionItem {
  label: unknown;
  content: unknown;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** Allow several sections open at once. */
  multiple?: boolean;
  /** Which section starts open. `-1` for all closed. */
  defaultIndex?: number;
  class?: string;
  [key: string]: unknown;
}

export function Accordion(props: AccordionProps): HtmlNode {
  const { items, multiple, defaultIndex, class: cls, ...rest } = props;

  return (
    <HeadlessAccordion
      {...rest}
      items={items}
      {...(multiple ? { multiple } : {})}
      {...(defaultIndex !== undefined ? { defaultIndex } : {})}
      class={cn("divide-y divide-border border-y border-border", cls)}
      itemClass=""
      buttonClass={cn(
        "flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium",
        "transition-colors hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // The headless layer sets data-open on the trigger, so the chevron can
        // rotate from CSS alone with no extra state to keep in sync.
        "[&[data-open]>svg]:rotate-180",
      )}
      panelClass="pb-4 text-sm text-muted-foreground"
    />
  );
}
