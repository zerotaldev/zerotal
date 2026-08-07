// ── <DropdownMenu> ──────────────────────────────────────────────────────────
//
// A themed menu. Built fresh over Flow's
// `flowMenu()` client runtime (full keyboard nav: Down/Up/Home/End/Enter/Escape,
// click-outside close) with token-themed surfaces. Compose items with the
// sub-components.
//
//   <DropdownMenu label="Options">
//     <DropdownMenuLabel>My account</DropdownMenuLabel>
//     <DropdownMenuItem onClick={this.profile}>Profile</DropdownMenuItem>
//     <DropdownMenuSeparator />
//     <DropdownMenuItem variant="destructive" onClick={this.signOut}>Sign out</DropdownMenuItem>
//   </DropdownMenu>

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface DropdownMenuProps {
  label?: unknown;
  /** Custom trigger (overrides `label` + default button styling). */
  trigger?: unknown;
  align?: "left" | "right";
  class?: string;
  /** Classes for the menu panel. */
  panelClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function DropdownMenu(props: DropdownMenuProps): HtmlNode {
  const { label, trigger, align = "left", class: cls, panelClass, children, ...rest } = props;

  const triggerCommon = {
    "x-on:click": "toggle()",
    "x-on:keydown": "onButtonKey($event)",
    "aria-haspopup": "menu",
    ":aria-expanded": "open",
  };
  const triggerNode = trigger
    ? jsx("span", {
        ...triggerCommon,
        role: "button",
        tabindex: 0,
        class: "inline-flex cursor-pointer",
        children: trigger,
      })
    : jsx("button", {
        ...triggerCommon,
        type: "button",
        class:
          "inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
        children: [
          label ?? "Menu",
          jsx("span", { "aria-hidden": "true", class: "text-xs opacity-60", children: "▾" }),
        ],
      });

  const panel = jsx("div", {
    role: "menu",
    "x-show": "open",
    "x-cloak": true,
    "x-transition": true,
    "x-on:keydown": "onKey($event)",
    "x-on:click.outside": "close(false)",
    "x-on:keydown.escape.window": "open && close(false)",
    class: cn(
      "absolute z-50 mt-2 min-w-32 overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
      align === "right" ? "right-0" : "left-0",
      panelClass,
    ),
    children,
  });

  return jsx("div", {
    ...rest,
    "x-data": "flowMenu()",
    class: cn("relative inline-block", cls),
    children: [triggerNode, panel],
  });
}

export interface DropdownMenuItemProps {
  variant?: "default" | "destructive";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function DropdownMenuItem(props: DropdownMenuItemProps): HtmlNode {
  const { variant = "default", class: cls, children, ...rest } = props;
  return jsx("button", {
    ...rest,
    type: "button",
    role: "menuitem",
    class: cn(
      "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
      variant === "destructive" &&
        "text-destructive focus:bg-destructive/10 focus:text-destructive hover:bg-destructive/10 hover:text-destructive dark:focus:bg-destructive/20 [&_svg:not([class*='text-'])]:text-destructive",
      cls,
    ),
    children,
  });
}

export interface DropdownMenuLabelProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function DropdownMenuLabel(props: DropdownMenuLabelProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("div", {
    ...rest,
    class: cn("px-2 py-1.5 text-sm font-medium text-foreground", cls),
    children,
  });
}

export interface DropdownMenuSeparatorProps {
  class?: string;
  [key: string]: unknown;
}

export function DropdownMenuSeparator(props: DropdownMenuSeparatorProps = {}): HtmlNode {
  const { class: cls, ...rest } = props;
  return jsx("div", { ...rest, role: "none", class: cn("-mx-1 my-1 h-px bg-border", cls) });
}

export interface DropdownMenuShortcutProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

// A right-aligned hint for an item's keyboard shortcut, e.g. ⌘K.
//
//   <DropdownMenuItem>Settings<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></DropdownMenuItem>
export function DropdownMenuShortcut(props: DropdownMenuShortcutProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return jsx("span", {
    ...rest,
    class: cn("ml-auto text-xs tracking-widest text-muted-foreground", cls),
    children,
  });
}
