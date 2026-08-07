/** @jsxImportSource @zerotal/flow */
// ── <Collapsible> ───────────────────────────────────────────────────────────
//
// One section that opens and closes. The single-section counterpart to
// <Accordion>: use this for "Show advanced options", and the accordion when
// several sections compete for the same space.
//
// Wraps the headless disclosure, so the trigger already carries `aria-expanded`
// and points at the panel it controls.
//
//   <Collapsible label="Advanced">
//     <Field label="Timeout"><Input /></Field>
//   </Collapsible>

import type { HtmlNode } from "@zerotal/flow";
import { Disclosure } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CollapsibleProps {
  /** Text for the default trigger. */
  label?: unknown;
  /** A custom trigger, replacing the default button. */
  trigger?: unknown;
  defaultOpen?: boolean;
  /** Classes for the panel. */
  class?: string;
  triggerClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Collapsible(props: CollapsibleProps): HtmlNode {
  const { label, trigger, defaultOpen, class: cls, triggerClass, children, ...rest } = props;

  return (
    <Disclosure
      {...rest}
      {...(label !== undefined ? { label } : {})}
      {...(trigger ? { trigger } : {})}
      {...(defaultOpen ? { defaultOpen } : {})}
      buttonClass={cn(
        "inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-foreground",
        "transition-colors hover:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "[&[data-open]>svg]:rotate-180",
        triggerClass,
      )}
      panelClass={cn("pt-2", cls)}
    >
      {children}
    </Disclosure>
  );
}
