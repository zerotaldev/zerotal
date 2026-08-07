/** @jsxImportSource @zerotal/flow */
// ── <Skeleton> ──────────────────────────────────────────────────────────────
//
// A pulsing placeholder block. Size it with utility
// classes via `class`.
//
//   <Skeleton class="h-4 w-32" />
//   <Skeleton class="h-12 w-12 rounded-full" />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SkeletonProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Skeleton(props: SkeletonProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <div class={cn("animate-pulse rounded-md bg-muted", cls)} {...rest}>
      {children}
    </div>
  );
}
