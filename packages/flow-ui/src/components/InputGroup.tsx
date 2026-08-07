/** @jsxImportSource @zerotal/flow */
// ── <InputGroup> ────────────────────────────────────────────────────────────
//
// An input with something attached — a currency symbol, a unit, a search glyph,
// a button. Common enough that every app grows a half-version of it, usually as
// an absolutely-positioned span that overlaps the text once the value is long.
//
// Two attachment kinds, and the distinction matters:
//
// **Addons** sit outside the input in their own bordered cell — for a domain
// suffix or a "Copy" button, things that are separate from the value.
// **Affixes** sit inside the input's border and the text is padded away from
// them — for a currency symbol or a search icon, things that read as part of
// the value.
//
//   <InputGroup prefix="R"><Input flow:model="form.price" /></InputGroup>
//   <InputGroup addonAfter={<Button size="sm">Copy</Button>}><Input value={key} /></InputGroup>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface InputGroupProps {
  /** Inside the border, before the text — a currency symbol, a search icon. */
  prefix?: unknown;
  /** Inside the border, after the text — a unit, a clear button. */
  suffix?: unknown;
  /** Outside the border, before the input — a protocol, a select. */
  addonBefore?: unknown;
  /** Outside the border, after the input — a domain suffix, an action button. */
  addonAfter?: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

const addonClass =
  "inline-flex shrink-0 items-center border border-input bg-muted px-3 text-sm text-muted-foreground";

export function InputGroup(props: InputGroupProps): HtmlNode {
  const { prefix, suffix, addonBefore, addonAfter, class: cls, children, ...rest } = props;

  return (
    <div class={cn("flex w-full items-stretch", cls)} {...rest}>
      {addonBefore ? (
        <span class={cn(addonClass, "rounded-l-md border-r-0")}>{addonBefore}</span>
      ) : null}

      <div class="relative flex-1">
        {prefix ? (
          <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}

        {/* The input's own rounding is overridden per side, so a group with an
            addon on one end still reads as a single control. Padding comes from
            here rather than the caller, because only this knows what is inside. */}
        <div
          class={cn(
            "[&>input]:w-full",
            Boolean(prefix) && "[&>input]:pl-8",
            Boolean(suffix) && "[&>input]:pr-10",
            Boolean(addonBefore) && "[&>input]:rounded-l-none",
            Boolean(addonAfter) && "[&>input]:rounded-r-none",
          )}
        >
          {children}
        </div>

        {suffix ? (
          <span class="absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>

      {addonAfter ? (
        // A button addon supplies its own surface, so the muted cell is dropped
        // and only the rounding is corrected.
        <span class="inline-flex shrink-0 items-center [&>button]:rounded-l-none">
          {addonAfter}
        </span>
      ) : null}
    </div>
  );
}
