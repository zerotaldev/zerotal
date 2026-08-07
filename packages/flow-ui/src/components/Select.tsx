/** @jsxImportSource @zerotal/flow */
// ── <Select> ────────────────────────────────────────────────────────────────
//
// A themed native select. Composes
// Flow's headless Select (a styled native <select> bound via flow:model), so it
// stays fully accessible and reliable.
//
//   <Select bind={this.country} options={[{ label: "Canada", value: "ca" }]} />

import type { HtmlNode } from "@zerotal/flow";
import { Select as HeadlessSelect } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SelectOption {
  label: unknown;
  value: string | number;
}

export interface SelectProps {
  bind: unknown;
  options: SelectOption[];
  placeholder?: string;
  class?: string;
  [key: string]: unknown;
}

export function Select(props: SelectProps): HtmlNode {
  const { bind, options, placeholder, class: cls, ...rest } = props;
  return HeadlessSelect({
    bind,
    options,
    ...(placeholder !== undefined ? { placeholder } : {}),
    class: cn(
      "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      cls,
    ),
    ...rest,
  });
}
