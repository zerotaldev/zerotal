// ── <Sheet> ─────────────────────────────────────────────────────────────────
//
// A themed slide-over panel — the edge-anchored cousin
// of <Dialog>. Built fresh over Flow's proven Drawer directives (x-show + slide
// transition + x-trap focus trap, backdrop/×/Escape close) but fully token-themed.
//
//   <Sheet show={this.cart} side="right" title="Your cart">…</Sheet>

import { jsx, _resolveReactiveName, _injectedBindKey } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SheetProps {
  /** Bound @expose boolean controlling visibility — `this.open`. */
  show?: unknown;
  /** Explicit prop-name override when value auto-resolve is ambiguous. */
  name?: string;
  onClose?: unknown;
  title?: unknown;
  description?: unknown;
  closable?: boolean;
  side?: "left" | "right" | "top" | "bottom";
  /** Classes for the panel. */
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

const _SIDE: Record<string, { pos: string; closed: string }> = {
  right: { pos: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l", closed: "translate-x-full" },
  left: { pos: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r", closed: "-translate-x-full" },
  top: { pos: "inset-x-0 top-0 w-full border-b", closed: "-translate-y-full" },
  bottom: { pos: "inset-x-0 bottom-0 w-full border-t", closed: "translate-y-full" },
};

export function Sheet(props: SheetProps): HtmlNode {
  const {
    show,
    name: nameProp,
    onClose,
    title,
    description,
    closable = true,
    side = "right",
    class: panelClass,
    children,
    ...rest
  } = props;

  const name = nameProp ?? _injectedBindKey(props, "show") ?? _resolveReactiveName(show);
  const open = Boolean(show);
  const s = _SIDE[side] ?? _SIDE["right"]!;
  const shownExpr = name ? `$flow.${name}` : open ? "true" : "false";
  const inAxis = side === "left" || side === "right" ? "translate-x-0" : "translate-y-0";

  const closeProps: Record<string, unknown> = onClose
    ? { onClick: onClose }
    : name
      ? { "flow:click": `$flow.${name} = false` }
      : {};

  const backdrop = jsx("div", {
    "x-show": shownExpr,
    "x-cloak": true,
    "x-transition:enter": "transition-opacity ease-out duration-300",
    "x-transition:enter-start": "opacity-0",
    "x-transition:enter-end": "opacity-100",
    "x-transition:leave": "transition-opacity ease-in duration-200",
    "x-transition:leave-start": "opacity-100",
    "x-transition:leave-end": "opacity-0",
    class: "fixed inset-0 z-40 bg-black/50",
    ...closeProps,
  });

  const titleId = name ? `flow-sheet-title-${name}` : undefined;
  const descId = name && description ? `flow-sheet-desc-${name}` : undefined;

  const header =
    title || description
      ? jsx("div", {
          class: "mb-4 flex flex-col gap-1.5 pr-6",
          children: [
            title
              ? jsx("h2", {
                  id: titleId,
                  class: "text-lg font-semibold text-foreground",
                  children: title,
                })
              : "",
            description
              ? jsx("p", {
                  id: descId,
                  class: "text-sm text-muted-foreground",
                  children: description,
                })
              : "",
          ],
        })
      : "";

  const closeButton = closable
    ? jsx("button", {
        type: "button",
        "aria-label": "Close",
        class:
          "absolute right-4 top-4 rounded-sm opacity-70 text-foreground/70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-xl leading-none",
        children: "×",
        ...closeProps,
      })
    : "";

  const panelOut: Record<string, unknown> = {
    role: "dialog",
    "aria-modal": "true",
    "x-show": shownExpr,
    "x-cloak": true,
    "x-transition:enter": "transform transition ease-out duration-300",
    "x-transition:enter-start": s.closed,
    "x-transition:enter-end": inAxis,
    "x-transition:leave": "transform transition ease-in duration-200",
    "x-transition:leave-start": inAxis,
    "x-transition:leave-end": s.closed,
    class: cn(
      "fixed z-50 overflow-auto border-border bg-background p-6 text-foreground shadow-lg",
      s.pos,
      panelClass,
    ),
    children: [closeButton, header, children],
  };
  if (name) {
    panelOut["data-flow-modal"] = name; // Escape-to-close (shared bridge handler)
    panelOut["x-trap"] = shownExpr; // trap focus while open
    if (title) panelOut["aria-labelledby"] = titleId;
    if (descId) panelOut["aria-describedby"] = descId;
  }

  // `contents` wrapper makes no box, so the fixed backdrop/panel aren't blocked and
  // nothing intercepts clicks when closed (both are display:none via x-show).
  return jsx("div", { ...rest, class: "contents", children: [backdrop, jsx("div", panelOut)] });
}
