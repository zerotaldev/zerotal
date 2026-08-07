/** @jsxImportSource @zerotal/flow */
// ── <Combobox> ──────────────────────────────────────────────────────────────
//
// A text input with a filtered list under it — the control for choosing one of
// many. Where <Select> is fine for five options and unusable for five hundred,
// this stays usable because you type instead of scroll.
//
// Wraps the headless combobox, which handles the filtering, the keyboard
// navigation and the `aria-activedescendant` bookkeeping. Two modes come from
// there: filtering the given options on the client, or binding a `query` prop so
// the server narrows them — the second is what you want when the list is a table.
//
//   <Combobox bind={this.brandId} options={brands} placeholder="Search brands…" />
//   <Combobox bind={this.userId} query={this.search} options={this.matches} />

import type { HtmlNode } from "@zerotal/flow";
import { Combobox as HeadlessCombobox } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** The bound @expose value. */
  bind?: unknown;
  /** Bind a query prop to filter on the server instead of the client. */
  query?: unknown;
  name?: string;
  queryName?: string;
  options: ComboboxOption[];
  placeholder?: string;
  /** Classes for the input. */
  class?: string;
  [key: string]: unknown;
}

export function Combobox(props: ComboboxProps): HtmlNode {
  const { bind, query, name, queryName, options, placeholder, class: cls, ...rest } = props;

  return (
    <HeadlessCombobox
      {...rest}
      options={options}
      {...(bind !== undefined ? { bind } : {})}
      {...(query !== undefined ? { query } : {})}
      {...(name ? { name } : {})}
      {...(queryName ? { queryName } : {})}
      {...(placeholder ? { placeholder } : {})}
      class="relative"
      inputClass={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        cls,
      )}
      optionsClass="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      // The headless layer marks the keyboard-focused row with data-active and
      // the chosen one with data-selected, so both states are styled from CSS
      // with no extra state to track here.
      optionClass={cn(
        "cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none",
        "data-active:bg-accent data-active:text-accent-foreground",
        "data-selected:font-medium",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
      )}
    />
  );
}
