/** @jsxImportSource @zerotal/flow */
// ── <RadioGroup> ────────────────────────────────────────────────────────────
//
// A themed segmented radio set, rendered as selectable cards. Composes
// Flow's headless RadioGroup (role="radiogroup", arrow-key roving, `data-checked`
// state) with token classes for each option.
//
//   <RadioGroup bind={this.plan} options={[{ label: "Pro", value: "pro" }]} />

import type { HtmlNode } from "@zerotal/flow";
import { RadioGroup as HeadlessRadioGroup } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface RadioOption {
  label: unknown;
  value: string | number;
}

export interface RadioGroupProps {
  bind: unknown;
  options: RadioOption[];
  class?: string;
  optionClass?: string;
  [key: string]: unknown;
}

export function RadioGroup(props: RadioGroupProps): HtmlNode {
  const { bind, options, class: cls, optionClass, ...rest } = props;
  return HeadlessRadioGroup({
    bind,
    options,
    class: cn("grid gap-2", cls),
    optionClass: cn(
      "flex cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
      optionClass,
    ),
    ...rest,
  });
}
