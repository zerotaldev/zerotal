/** @jsxImportSource @zerotal/flow */
// ── <InputOTP> ──────────────────────────────────────────────────────────────
//
// The one-time-code input: separate boxes, one character each.
//
// Built as a single real input with the boxes drawn behind it, rather than as N
// inputs with focus shuffled between them. The multi-input version is the common
// approach and it breaks the things people actually do with these codes: pasting
// all six characters at once, letting the browser autofill from an SMS, and
// selecting the lot to retype. One input keeps all of that for free — including
// `autocomplete="one-time-code"`, which is what triggers the OS suggestion.
//
//   <InputOTP length={6} flow:model="form.code" />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface InputOTPProps {
  /** How many characters the code has. */
  length?: number;
  /** Restrict to digits. Letters are allowed when false. */
  numeric?: boolean;
  /** Insert a wider gap after this many boxes — `3` gives `123 456`. */
  groupAfter?: number;
  disabled?: boolean;
  class?: string;
  [key: string]: unknown;
}

export function InputOTP(props: InputOTPProps): HtmlNode {
  const { length = 6, numeric = true, groupAfter, disabled, class: cls, ...rest } = props;

  const boxes = Array.from({ length }, (_, i) => i);

  return (
    <div
      x-data="{ value: '' }"
      class={cn("relative inline-flex", cls)}
      // Clicking anywhere on the boxes focuses the real input behind them.
      x-on:click="$refs.field.focus()"
    >
      <input
        x-ref="field"
        type="text"
        inputmode={numeric ? "numeric" : "text"}
        autocomplete="one-time-code"
        maxlength={length}
        {...(numeric ? { pattern: "[0-9]*" } : {})}
        {...(disabled ? { disabled: true } : {})}
        {...{ "x-model": "value" }}
        // Transparent and stretched over the boxes: it still receives every key,
        // paste and autofill, while the boxes below show the state.
        class="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
        {...rest}
      />
      <div class="flex items-center gap-2">
        {boxes.map((i) => (
          <>
            {groupAfter && i > 0 && i % groupAfter === 0 ? <span class="w-2" /> : null}
            <div
              class={cn(
                "flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors",
                disabled && "opacity-50",
              )}
              // The box holding the caret is ringed, which is the only cue the
              // reader has about where the next character lands.
              {...{
                "x-bind:class": `value.length === ${i} && 'ring-2 ring-ring border-ring'`,
              }}
            >
              <span {...{ "x-text": `value[${i}] || ''` }} />
            </div>
          </>
        ))}
      </div>
    </div>
  );
}
