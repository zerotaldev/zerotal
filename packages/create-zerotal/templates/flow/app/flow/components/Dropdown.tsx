import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";

export interface DropdownItem {
  label: string;
  icon?: IconName | undefined;
  /** A link. */
  href?: string | undefined;
  /** A form post instead of a link — sign out is a POST. */
  post?: string | undefined;
  /** Sets light, dark or system (resources/js/lib/theme.ts). */
  appearance?: "light" | "dark" | "system" | undefined;
  danger?: boolean | undefined;
}

let sequence = 0;

/**
 * A menu behind a button, usable from the keyboard: Enter, Space or Arrow Down opens it on
 * the first item, the arrows and Home/End move between items, Escape closes it and
 * returns focus to the button, and Tab leaves it.
 *
 * The markup is written here, with the items in a `<template>`; resources/js/lib/dropdowns.ts
 * puts them in the menu when it opens and takes them out when it closes, so a closed menu
 * holds nothing for a search or a screen reader to trip over. Without the script the
 * button does nothing, so keep anything vital reachable another way too.
 */
export function Dropdown({
  trigger,
  label,
  header,
  items,
  align = "end",
  side = "bottom",
  class: className,
}: {
  /** The button's content. */
  trigger: unknown;
  /** The button's accessible name, when `trigger` is not text. */
  label?: string | undefined;
  /** Non-interactive content above the items — the signed-in user's name, say. */
  header?: unknown;
  items: DropdownItem[];
  align?: "start" | "end" | undefined;
  side?: "top" | "bottom" | undefined;
  class?: string | undefined;
}): HtmlNode {
  const menuId = `menu-${++sequence}`;

  const itemClass = (danger?: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors",
      "focus-visible:bg-muted hover:bg-muted",
      danger ? "text-destructive" : "text-foreground",
    );

  const content = (item: DropdownItem) => (
    <>
      {item.icon ? <Icon name={item.icon} class="size-4 shrink-0 opacity-70" /> : null}
      {item.label}
    </>
  );

  return (
    <div data-dropdown="" class={cn("relative", className)}>
      <button
        type="button"
        data-dropdown-trigger=""
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls={menuId}
        aria-label={label}
        class="w-full rounded-lg"
      >
        {trigger}
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label={label}
        hidden
        class={cn(
          "absolute z-50 min-w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl",
          align === "end" ? "right-0" : "left-0",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
        )}
      />
      <template data-dropdown-items="">
        {header ? (
          <div class="mb-1.5 border-b border-border px-2.5 pt-1.5 pb-2.5">{header}</div>
        ) : null}
        {items.map((item) => {
          if (item.href) {
            return (
              <a href={item.href} role="menuitem" tabindex="-1" class={itemClass(item.danger)}>
                {content(item)}
              </a>
            );
          }
          if (item.post) {
            return (
              <form method="post" action={item.post}>
                <button type="submit" role="menuitem" tabindex="-1" class={itemClass(item.danger)}>
                  {content(item)}
                </button>
              </form>
            );
          }
          return (
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-appearance={item.appearance}
              class={itemClass(item.danger)}
            >
              {content(item)}
            </button>
          );
        })}
      </template>
    </div>
  );
}
