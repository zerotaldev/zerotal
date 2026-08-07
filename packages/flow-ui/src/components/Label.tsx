/** @jsxImportSource @zerotal/flow */
// ── <Label> ─────────────────────────────────────────────────────────────────
//
// A themed form label. Wraps Flow's headless
// `Label` so it keeps the `flow-label` hook (and any <Field> id wiring) while
// adding token-backed default classes.
//
//   <Label for="email">Email</Label>

import type { HtmlNode } from "@zerotal/flow";
import { Label as HeadlessLabel } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface LabelProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Label(props: LabelProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return HeadlessLabel({
    ...rest,
    class: cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      cls,
    ),
    children,
  });
}
