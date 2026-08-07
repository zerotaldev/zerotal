/** @jsxImportSource @zerotal/flow */
// ── <Toggle> / <ToggleGroup> ────────────────────────────────────────────────
//
// A button that stays pressed. Distinct from <Switch>, and the difference is not
// cosmetic: a switch is a setting that takes effect immediately ("Email me"), a
// toggle is a mode you are in ("Bold", "List view"). Assistive technology is told
// which through `aria-pressed` here versus `role="switch"` there.
//
// <ToggleGroup> is a set of them — a segmented control. It wraps the headless
// toggle group, so pressing flips the state on the client immediately and syncs
// the bound prop after. A segmented control that waits for a round-trip before
// it looks pressed feels broken even when the server answers quickly, and the
// press is pure UI state until it settles.
//
// `multiple` decides whether the bound value is a string or an array.
//
//   <Toggle pressed={this.bold} onClick={this.toggleBold}>B</Toggle>
//   <ToggleGroup bind={this.view}
//     options={[{ value: "list", label: "List" }, { value: "grid", label: "Grid" }]} />

import type { HtmlNode } from "@zerotal/flow";
import { ToggleGroup as HeadlessToggleGroup } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";
import { gva } from "../utils/gva.ts";

export const toggleVariants = gva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent",
      },
      size: {
        sm: "h-8 px-2",
        default: "h-9 px-2.5",
        lg: "h-10 px-3",
      },
      pressed: {
        true: "bg-accent text-accent-foreground",
        false: "",
      },
    },
    defaultVariants: { variant: "default", size: "default", pressed: "false" },
  },
);

export interface ToggleProps {
  pressed?: boolean;
  variant?: "default" | "outline";
  size?: "sm" | "default" | "lg";
  disabled?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Toggle(props: ToggleProps): HtmlNode {
  const { pressed = false, variant, size, disabled, class: cls, children, ...rest } = props;
  return (
    <button
      type="button"
      aria-pressed={pressed ? "true" : "false"}
      {...(disabled ? { disabled: true } : {})}
      class={toggleVariants({ variant, size, pressed: pressed ? "true" : "false", class: cls })}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface ToggleOption {
  value: string;
  label: unknown;
  /** Accessible name, for an option whose label is only an icon. */
  ariaLabel?: string;
}

export interface ToggleGroupProps {
  /** Bound @expose value — a string, or an array when `multiple`. */
  bind?: unknown;
  name?: string;
  options: ToggleOption[];
  /** Allow several pressed at once; the bound value becomes an array. */
  multiple?: boolean;
  variant?: "default" | "outline";
  size?: "sm" | "default" | "lg";
  class?: string;
  [key: string]: unknown;
}

export function ToggleGroup(props: ToggleGroupProps): HtmlNode {
  const { bind, name, options, multiple, variant = "outline", size, class: cls, ...rest } = props;

  return (
    <HeadlessToggleGroup
      {...rest}
      {...(bind !== undefined ? { bind } : {})}
      {...(name ? { name } : {})}
      {...(multiple ? { multiple } : {})}
      options={options}
      class={cn("inline-flex items-center gap-1 rounded-md", cls)}
      // Styled from `data-pressed`, which Alpine sets the instant the button is
      // clicked — so the press lands before any round-trip, and still looks
      // right on the server-rendered first paint.
      optionClass={cn(
        toggleVariants({ variant, size }),
        "data-pressed:bg-accent data-pressed:text-accent-foreground",
      )}
    />
  );
}
