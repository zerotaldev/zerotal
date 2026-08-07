/** @jsxImportSource @zerotal/flow */
// ── <ButtonGroup> ───────────────────────────────────────────────────────────
//
// Buttons joined into one control — "Save" with a dropdown of save variants, or
// a set of related actions that belong together visually.
//
// Different from a row of buttons with a gap: joining them says the actions are
// alternatives to each other. Use the gap when they are not.
//
// The rounding and the doubled borders between members are corrected here rather
// than by each button, so any button variant can be a member without knowing it
// is in a group.
//
//   <ButtonGroup>
//     <Button variant="outline">Day</Button>
//     <Button variant="outline">Week</Button>
//   </ButtonGroup>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ButtonGroupProps {
  orientation?: "horizontal" | "vertical";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function ButtonGroup(props: ButtonGroupProps): HtmlNode {
  const { orientation = "horizontal", class: cls, children, ...rest } = props;

  const horizontal = orientation === "horizontal";

  return (
    <div
      role="group"
      class={cn(
        "inline-flex",
        horizontal ? "flex-row" : "flex-col",
        // Square off the inner corners and collapse the shared border, so the
        // members read as one control rather than several stuck together.
        horizontal
          ? "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>*:not(:first-child)]:-ml-px"
          : "[&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none [&>*:not(:first-child)]:-mt-px",
        // A focused member has to sit above its neighbours or its ring is clipped.
        "[&>*:focus-visible]:relative [&>*:focus-visible]:z-10",
        cls,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
