/** @jsxImportSource @zerotal/flow */
// ── <Menubar> ───────────────────────────────────────────────────────────────
//
// The application menu bar — File, Edit, View — for tool-like interfaces: an
// editor, a builder, a dashboard designer. It is the wrong shape for an ordinary
// CRUD screen, where a toolbar of visible buttons serves better.
//
// The behaviour that makes a menu bar feel right is hover-to-switch: once one
// menu is open, moving across the bar opens the next without another click. That
// is the whole difference between this and a row of dropdowns, so it is what the
// shared state here exists for.
//
//   <Menubar menus={[
//     { label: "File", items: [{ label: "New", action: "$flow.create()" }] },
//     { label: "Edit", items: [{ label: "Undo", shortcut: "⌘Z", action: "$flow.undo()" }] },
//   ]} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";
import type { ContextMenuItem } from "./ContextMenu.tsx";

export interface MenubarMenu {
  label: unknown;
  items: ContextMenuItem[];
}

export interface MenubarProps {
  menus: MenubarMenu[];
  class?: string;
  [key: string]: unknown;
}

export function Menubar(props: MenubarProps): HtmlNode {
  const { menus, class: cls, ...rest } = props;

  return (
    <div
      // One open index for the whole bar, which is what allows hovering from
      // one menu to the next to switch between them.
      x-data="{ open: -1 }"
      {...{ "x-on:click.outside": "open = -1" }}
      {...{ "x-on:keydown.escape.window": "open = -1" }}
      role="menubar"
      class={cn("flex items-center gap-0.5 rounded-md border border-border bg-card p-1", cls)}
      {...rest}
    >
      {menus.map((menu, i) => (
        <div class="relative">
          <button
            type="button"
            role="menuitem"
            {...{ "x-on:click": `open = open === ${i} ? -1 : ${i}` }}
            // Only switches when something is already open, so a pointer merely
            // crossing the bar does not fire menus off.
            {...{ "x-on:mouseenter": `if (open !== -1) open = ${i}` }}
            {...{ "x-bind:aria-expanded": `open === ${i}` }}
            {...{
              "x-bind:class": `open === ${i} && 'bg-accent text-accent-foreground'`,
            }}
            class="rounded-sm px-3 py-1 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {menu.label}
          </button>

          <div
            {...{ "x-show": `open === ${i}` }}
            x-cloak
            x-transition
            role="menu"
            class="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {menu.items.map((item) =>
              item.separator ? (
                <div role="separator" class="-mx-1 my-1 h-px bg-border" />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  {...(item.disabled ? { disabled: true } : {})}
                  {...(item.action ? { "x-on:click": `${item.action}; open = -1` } : {})}
                  class={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                    item.danger && "text-destructive hover:bg-destructive/10",
                  )}
                >
                  {item.icon}
                  <span class="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span class="text-xs text-muted-foreground">{item.shortcut}</span>
                  ) : null}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
