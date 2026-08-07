/** @jsxImportSource @zerotal/flow */
// ── <Switch> ────────────────────────────────────────────────────────────────
//
// A themed on/off toggle. Composes Flow's headless
// Switch (accessible role="switch", `data-checked` state, server-synced) and just
// supplies token-backed default classes for the track and knob. Bind it to an
// @expose boolean:
//
//   <Switch bind={this.notifications} />

import type { HtmlNode } from "@zerotal/flow";
import { Switch as HeadlessSwitch } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SwitchProps {
  /** Bound @expose boolean — `this.enabled`. */
  bind: unknown;
  class?: string;
  [key: string]: unknown;
}

export function Switch(props: SwitchProps): HtmlNode {
  const {
    bind,
    class: cls,
    children: _ignore,
    ...rest
  } = props as SwitchProps & {
    children?: unknown;
  };
  return HeadlessSwitch({
    bind,
    class: cn(
      "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-input data-checked:bg-primary",
      cls,
    ),
    children: (
      <span class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform translate-x-0 group-data-checked:translate-x-4" />
    ),
    ...rest,
  });
}
