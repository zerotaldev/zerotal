/** @jsxImportSource @zerotal/flow */
// ── <NavigationMenu> ────────────────────────────────────────────────────────
//
// Top-level site navigation, where some items open a panel of links rather than
// going somewhere themselves. The marketing-site header, essentially.
//
// The links are real links with real hrefs, and a top-level item that has a panel
// still navigates when it has an `href`. That matters: navigation built out of
// buttons and click handlers cannot be opened in a new tab, cannot be
// middle-clicked, and is invisible to a crawler. The panel is an enhancement over
// working links, not a replacement for them.
//
//   <NavigationMenu items={[
//     { label: "Docs", href: "/docs" },
//     { label: "Products", panel: [{ label: "Admin", href: "/admin", description: "…" }] },
//   ]} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface NavigationPanelLink {
  label: unknown;
  href: string;
  /** A line explaining where it goes. */
  description?: unknown;
  icon?: unknown;
}

export interface NavigationMenuItem {
  label: unknown;
  href?: string;
  /** Links revealed on hover or focus. */
  panel?: NavigationPanelLink[];
  /** Columns for the panel grid. */
  columns?: 1 | 2;
}

export interface NavigationMenuProps {
  items: NavigationMenuItem[];
  class?: string;
  [key: string]: unknown;
}

const triggerClass =
  "inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NavigationMenu(props: NavigationMenuProps): HtmlNode {
  const { items, class: cls, ...rest } = props;

  return (
    <nav class={cn("relative flex items-center gap-1", cls)} {...rest}>
      {items.map((item) => {
        if (!item.panel?.length) {
          return (
            <a href={item.href} navigate class={triggerClass}>
              {item.label}
            </a>
          );
        }

        const Trigger = item.href ? "a" : "button";
        return (
          <div
            x-data="{ open: false }"
            {...{ "x-on:mouseenter": "open = true" }}
            {...{ "x-on:mouseleave": "open = false" }}
            {...{ "x-on:focusin": "open = true" }}
            {...{ "x-on:focusout": "open = false" }}
            class="relative"
          >
            <Trigger
              {...(item.href ? { href: item.href, navigate: true } : { type: "button" })}
              {...{ "x-bind:aria-expanded": "open" }}
              class={triggerClass}
            >
              {item.label}
              <svg
                class="h-3 w-3 transition-transform"
                {...{ "x-bind:class": "open && 'rotate-180'" }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Trigger>

            <div
              x-show="open"
              x-cloak
              x-transition
              class={cn(
                "absolute left-0 top-full z-50 mt-1.5 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg",
                item.columns === 2 ? "grid w-[34rem] grid-cols-2 gap-1" : "w-72 space-y-1",
              )}
            >
              {item.panel.map((link) => (
                <a
                  href={link.href}
                  navigate
                  class="flex gap-3 rounded-md p-3 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {link.icon ? <span class="shrink-0 pt-0.5">{link.icon}</span> : null}
                  <span class="min-w-0">
                    <span class="block text-sm font-medium">{link.label}</span>
                    {link.description ? (
                      <span class="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {link.description}
                      </span>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
