/** @jsxImportSource @zerotal/flow */
// ── <Checkbox> ──────────────────────────────────────────────────────────────
//
// A themed checkbox. Composes Flow's headless
// Checkbox (role="checkbox", `data-checked` state, server-synced) with token
// classes and a check glyph shown when checked.
//
//   <Checkbox bind={this.agree} />

import type { HtmlNode } from "@zerotal/flow";
import { Checkbox as HeadlessCheckbox } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CheckboxProps {
  /** Bound @expose boolean — `this.agree`. */
  bind: unknown;
  class?: string;
  [key: string]: unknown;
}

export function Checkbox(props: CheckboxProps): HtmlNode {
  const {
    bind,
    class: cls,
    children: _ignore,
    ...rest
  } = props as CheckboxProps & {
    children?: unknown;
  };
  return HeadlessCheckbox({
    bind,
    class: cn(
      "grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-primary text-transparent shadow outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground",
      cls,
    ),
    children: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        class="h-3.5 w-3.5"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    ),
    ...rest,
  });
}
