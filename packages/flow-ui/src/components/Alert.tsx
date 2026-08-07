// ── <Alert> ─────────────────────────────────────────────────────────────────
//
// A themed inline alert (variants: default,
// destructive). Token-based, so it follows the active theme. Optionally
// dismissible (client-only, no round-trip). Use <AlertTitle>/<AlertDescription>
// or pass `title` + children.
//
//   <Alert title="Heads up!">You can add components to your app.</Alert>
//   <Alert variant="destructive" title="Error" dismissible>Something went wrong.</Alert>

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";
import { gva } from "../utils/gva.ts";

export const alertVariants = gva("relative w-full rounded-lg border px-4 py-3 text-sm", {
  variants: {
    variant: {
      default: "bg-background text-foreground",
      destructive: "border-destructive/50 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps {
  variant?: "default" | "destructive";
  dismissible?: boolean;
  title?: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Alert(props: AlertProps): HtmlNode {
  const { variant = "default", dismissible, title, class: cls, children, ...rest } = props;
  const role = variant === "destructive" ? "alert" : "status";

  const body: unknown[] = [];
  if (title !== undefined && title !== null) {
    body.push(
      jsx("div", { class: "mb-1 font-medium leading-none tracking-tight", children: title }),
    );
  }
  body.push(jsx("div", { class: "text-sm [&_p]:leading-relaxed", children }));

  const inner: unknown[] = [jsx("div", { class: "min-w-0 flex-1", children: body })];
  if (dismissible) {
    inner.push(
      jsx("button", {
        type: "button",
        "aria-label": "Dismiss",
        "x-on:click": "shown = false",
        class: "shrink-0 text-current/70 hover:text-current text-lg leading-none",
        children: "×",
      }),
    );
  }

  return jsx("div", {
    ...rest,
    role,
    "x-data": "{ shown: true }",
    "x-show": "shown",
    class: cn(alertVariants({ variant }), "flex items-start gap-3", cls),
    children: inner,
  });
}

export interface AlertTextProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function AlertTitle(props: AlertTextProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("div", {
    ...rest,
    class: cn("mb-1 font-medium leading-none tracking-tight", cls),
    children,
  });
}

export function AlertDescription(props: AlertTextProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("div", { ...rest, class: cn("text-sm [&_p]:leading-relaxed", cls), children });
}
