/** @jsxImportSource @zerotal/flow */
// ── <Button> ────────────────────────────────────────────────────────────────
//
// Themeable button. Classes come from token-backed
// `gva` variants (`bg-primary`, `text-foreground`, `ring-ring`… resolve to the
// flow-ui theme), and any `class` you pass is merged last so it wins. Everything
// else — `onClick={this.save}`, `type`, `disabled`, `flow:*` directives — passes
// straight through to the underlying <button>, so it stays a first-class Flow
// element with server actions and client expressions.
//
//   <Button onClick={this.save}>Save</Button>
//   <Button variant="destructive" size="sm" onClick={() => (this.open = true)}>Delete</Button>
//   <Button variant="outline" class="w-full">Full width</Button>

import type { HtmlNode } from "@zerotal/flow";
import { gva } from "../utils/gva.ts";

export const buttonVariants = gva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  type?: "button" | "submit" | "reset";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Button(props: ButtonProps): HtmlNode {
  const { variant, size, class: cls, type = "button", children, ...rest } = props;
  const className = buttonVariants({ variant, size, class: cls });
  return (
    <button type={type} class={className} {...rest}>
      {children}
    </button>
  );
}
