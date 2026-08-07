// ── <Dialog> ────────────────────────────────────────────────────────────────
//
// A themed modal dialog. Behaviourally identical to
// Flow's <Modal> — same `flow:show` toggle, focus trap (x-trap), backdrop/× close,
// and transition — but built fresh so every surface is token-themed (bg-background,
// text-foreground, border) and your `class` is merged via tailwind-merge so it wins.
//
// Flow's <Modal> bakes literal gray colours into its panel and appends `class`
// by string concat, so it can't be re-themed by wrapping — hence this standalone
// build over the same directives.
//
//   <Dialog show={this.open} title="Add contact" description="…">
//     …form…
//   </Dialog>

import { jsx } from "@zerotal/flow/jsx-runtime";
import { _resolveReactiveName, _injectedBindKey } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface DialogProps {
  /** Bound @expose boolean controlling visibility — `this.open`. */
  show?: unknown;
  /** Explicit prop-name override when value auto-resolve is ambiguous. */
  name?: string;
  /** Server action/handler invoked on close (overrides the default `name = false`). */
  onClose?: unknown;
  title?: unknown;
  description?: unknown;
  /** Show the × button + allow backdrop/Escape close (default true). */
  closable?: boolean;
  /** Classes for the dialog panel. */
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Dialog(props: DialogProps): HtmlNode {
  const {
    show,
    name: nameProp,
    onClose,
    title,
    description,
    closable = true,
    class: panelClass,
    children,
    ...rest
  } = props;

  const name = nameProp ?? _injectedBindKey(props, "show") ?? _resolveReactiveName(show);
  const open = Boolean(show);

  // Close wiring: an explicit handler wins; otherwise flip the bound prop on the client.
  const closeProps: Record<string, unknown> = onClose
    ? { onClick: onClose }
    : name
      ? { "flow:click": `$flow.${name} = false` }
      : {};

  const backdrop = jsx("div", {
    class: "absolute inset-0 bg-black/50",
    ...closeProps,
  });

  const titleId = name ? `flow-dialog-title-${name}` : undefined;
  const descId = name && description ? `flow-dialog-desc-${name}` : undefined;

  const header =
    title || closable || description
      ? jsx("div", {
          class: "mb-4 flex flex-col gap-1.5 pr-6",
          children: [
            title
              ? jsx("h2", {
                  id: titleId,
                  class: "text-lg font-semibold leading-none tracking-tight",
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

  const panel = jsx("div", {
    class: cn(
      "relative z-10 w-full max-w-lg rounded-lg border border-border bg-background p-6 text-foreground shadow-lg",
      panelClass,
    ),
    "flow:transition": true,
    children: [closeButton, header, children],
  });

  const overlay: Record<string, unknown> = {
    ...rest,
    role: "dialog",
    "aria-modal": "true",
    class: "fixed inset-0 z-50 flex items-center justify-center p-4",
    children: [backdrop, panel],
  };
  if (name) {
    overlay["flow:show"] = name;
    overlay["data-flow-modal"] = name;
    overlay["x-trap"] = `$flow.${name}`; // trap focus while open (@alpinejs/focus)
    if (title) overlay["aria-labelledby"] = titleId;
    if (descId) overlay["aria-describedby"] = descId;
  }
  if (!open) overlay["style"] = { display: "none" };

  return jsx("div", overlay);
}
