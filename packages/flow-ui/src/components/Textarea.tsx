/** @jsxImportSource @zerotal/flow */
// ── <Textarea> ──────────────────────────────────────────────────────────────
//
// A themed multi-line input. Forwards everything
// to <textarea>, so `value={this.form.bio}` binds two-way like a bare textarea.
//
//   <Textarea value={this.form.bio} placeholder="Tell us about yourself" rows={4} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface TextareaProps {
  class?: string;
  [key: string]: unknown;
}

export function Textarea(props: TextareaProps): HtmlNode {
  const { class: cls, ...rest } = props;
  return (
    <textarea
      class={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        cls,
      )}
      {...rest}
    />
  );
}
