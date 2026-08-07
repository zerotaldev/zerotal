/** @jsxImportSource @zerotal/flow */
// ── <ContextMenu> ───────────────────────────────────────────────────────────
//
// The right-click menu. Useful over table rows and canvas items, where a visible
// button per action would crowd the surface.
//
// Two rules make it safe to use. It is always a *shortcut* to something reachable
// another way — an action available only on right-click is invisible to anyone
// using a keyboard, a touchscreen, or simply not expecting it. And it is
// positioned at the pointer, clamped to the viewport, so a right-click near the
// bottom edge does not open a menu below the fold.
//
//   <ContextMenu items={[
//     { label: "Open", action: "$flow.open(id)" },
//     { separator: true },
//     { label: "Delete", action: "$flow.remove(id)", danger: true },
//   ]}>
//     <tr>…</tr>
//   </ContextMenu>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ContextMenuItem {
  label?: unknown;
  /** A Flow expression run on click. */
  action?: string;
  href?: string;
  icon?: unknown;
  /** Shortcut hint on the right. */
  shortcut?: string;
  /** Style as destructive. */
  danger?: boolean;
  disabled?: boolean;
  /** Render a divider instead of an item. */
  separator?: boolean;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function ContextMenu(props: ContextMenuProps): HtmlNode {
  const { items, class: cls, children, ...rest } = props;

  // Clamped against the viewport, using the menu's own measured size rather
  // than a guess, so the whole menu is always on screen.
  const open = `
    $event.preventDefault();
    open = true;
    $nextTick(() => {
      const menu = $refs.menu;
      const w = menu.offsetWidth, h = menu.offsetHeight;
      x = Math.min($event.clientX, window.innerWidth - w - 8);
      y = Math.min($event.clientY, window.innerHeight - h - 8);
    });
  `.replace(/\s+/g, " ");

  return (
    <div
      x-data="{ open: false, x: 0, y: 0 }"
      {...{ "x-on:contextmenu": open }}
      class="contents"
      {...rest}
    >
      {children}
      <div
        x-ref="menu"
        x-show="open"
        x-cloak
        {...{ "x-on:click.outside": "open = false" }}
        {...{ "x-on:keydown.escape.window": "open = false" }}
        {...{ "x-bind:style": "`position:fixed;left:${x}px;top:${y}px`" }}
        role="menu"
        class={cn(
          "z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          cls,
        )}
      >
        {items.map((item) =>
          item.separator ? (
            <div role="separator" class="-mx-1 my-1 h-px bg-border" />
          ) : item.href ? (
            <a
              href={item.href}
              navigate
              role="menuitem"
              class={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                item.danger && "text-destructive hover:bg-destructive/10",
              )}
            >
              {item.icon}
              <span class="flex-1">{item.label}</span>
              {item.shortcut ? (
                <span class="text-xs text-muted-foreground">{item.shortcut}</span>
              ) : null}
            </a>
          ) : (
            <button
              type="button"
              role="menuitem"
              {...(item.disabled ? { disabled: true } : {})}
              {...(item.action ? { "x-on:click": `${item.action}; open = false` } : {})}
              class={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
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
  );
}
