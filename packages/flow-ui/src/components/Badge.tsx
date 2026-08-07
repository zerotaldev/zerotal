/** @jsxImportSource @zerotal/flow */
// ── <Badge> ─────────────────────────────────────────────────────────────────
//
// A small status pill, with token-backed variants.
//
//   <Badge>New</Badge>
//   <Badge variant="destructive">Overdue</Badge>
//   <Badge variant="outline">Draft</Badge>

import type { HtmlNode } from "@zerotal/flow";
import { gva } from "../utils/gva.ts";

export const badgeVariants = gva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps {
  variant?: "default" | "secondary" | "destructive" | "outline";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Badge(props: BadgeProps): HtmlNode {
  const { variant, class: cls, children, ...rest } = props;
  return (
    <span class={badgeVariants({ variant, class: cls })} {...rest}>
      {children}
    </span>
  );
}
