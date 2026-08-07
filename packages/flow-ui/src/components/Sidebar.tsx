/** @jsxImportSource @zerotal/flow */
// ── <Sidebar> ───────────────────────────────────────────────────────────────
//
// The navigation rail of an application shell: a header, groups of links with
// optional children and badges, and a footer.
//
// Takes a nav tree as data rather than composed children. A sidebar is generated
// from routes, resources or permissions in every real app — expressing it as
// markup means rebuilding the same active-state and nesting logic per app, and
// that logic is where the bugs are: a link that looks active on every sub-route,
// a group that collapses the section you are currently in, a mobile drawer that
// stays open after you navigate.
//
// Three behaviours are handled here so nobody has to remember them:
//
// - **Active state** matches the longest item, so `/admin/products/1/edit` marks
//   Products rather than also marking the Dashboard at `/admin`.
// - **A group containing the current page starts open**, whatever its default.
// - **The mobile drawer closes when a link in it is clicked**, which is
//   otherwise the most common thing left out.
//
//   <Sidebar brand="Zerotal" groups={nav} current={path} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface SidebarItem {
  label: unknown;
  href?: string | undefined;
  /** Inline SVG or an icon element. */
  icon?: unknown;
  /** Count or status shown on the right. */
  badge?: unknown;
  /** Tailwind classes for the badge — a colour per meaning. */
  badgeClass?: string | undefined;
  /** Nested links, rendered as a collapsible group. */
  children?: SidebarItem[];
  /**
   * Leaves the app rather than navigating within it — external docs, a
   * standalone dashboard. Opens in a new tab, and skips the client router.
   */
  external?: boolean | undefined;
}

export interface SidebarGroup {
  /** Heading above the group. Omit for an unlabelled block. */
  label?: unknown;
  items: SidebarItem[];
  /** Start a collapsible group closed. Ignored when `collapsibleGroups` is off. */
  collapsed?: boolean;
}

export interface SidebarProps {
  /** Content at the top — a wordmark, a workspace switcher. */
  brand?: unknown;
  /** Line under the brand. */
  tagline?: unknown;
  /** Where the brand links to. */
  brandHref?: string;
  groups: SidebarGroup[];
  /** The current path, for marking the active item. */
  current?: string;
  /** Content pinned to the bottom — a user menu, a version string. */
  footer?: unknown;
  /** Render the mobile drawer toggle. */
  collapsible?: boolean;
  /**
   * Let a labelled group be folded away by its heading.
   *
   * Built on `<details>`, so the fold works before any JavaScript runs and the
   * browser's find-on-page can open a closed group to reveal a match — neither
   * of which a hand-rolled toggle gets.
   */
  collapsibleGroups?: boolean;
  /** Content between the brand and the nav — banners, a search box. */
  beforeNav?: unknown;
  /** Content below the nav, above the footer. */
  afterNav?: unknown;
  class?: string;
  [key: string]: unknown;
}

/**
 * Whether an item is the one the current path is inside.
 *
 * Prefix matching, but only on a path boundary — otherwise `/admin/order` would
 * light up for `/admin/orders`, which is a different resource entirely.
 */
export function isActive(href: string | undefined, current: string | undefined): boolean {
  if (!href || !current) return false;
  if (href === current) return true;
  return current.startsWith(href.endsWith("/") ? href : `${href}/`);
}

/**
 * The single best match in a flat list of hrefs.
 *
 * The longest match wins, so a panel root at `/admin` does not stay highlighted
 * for every page beneath it.
 */
function activeHref(groups: SidebarGroup[], current: string | undefined): string | null {
  let best: string | null = null;
  const consider = (href?: string): void => {
    if (isActive(href, current) && (!best || href!.length > best.length)) best = href!;
  };
  for (const group of groups) {
    for (const item of group.items) {
      consider(item.href);
      for (const child of item.children ?? []) consider(child.href);
    }
  }
  return best;
}

const linkClass =
  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors";

function Badge({ value, class: cls }: { value: unknown; class?: string | undefined }): HtmlNode {
  return (
    <span
      class={cn(
        "ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        cls ?? "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

function Link({ item, active }: { item: SidebarItem; active: boolean }): HtmlNode {
  return (
    <a
      href={item.href}
      // `rel="noreferrer"` alongside the new tab: an external link opened with
      // `target` otherwise hands the destination a handle on this window.
      {...(item.external ? { target: "_blank", rel: "noreferrer" } : { navigate: true })}
      {...(active ? { "aria-current": "page" } : {})}
      class={cn(
        linkClass,
        "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        // Styled from the attribute as well as the server-computed flag: the
        // client router marks the active link after a soft navigation, and a
        // rule keyed only on the server's answer would leave it unstyled.
        "[&[aria-current]]:bg-accent [&[aria-current]]:text-accent-foreground",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {item.icon ? <span class="shrink-0">{item.icon}</span> : null}
      <span class="truncate">{item.label}</span>
      {item.badge !== undefined ? <Badge value={item.badge} class={item.badgeClass} /> : null}
    </a>
  );
}

export function Sidebar(props: SidebarProps): HtmlNode {
  const {
    brand,
    tagline,
    brandHref = "/",
    groups,
    current,
    footer,
    collapsible = true,
    collapsibleGroups,
    beforeNav,
    afterNav,
    class: cls,
    ...rest
  } = props;

  const active = activeHref(groups, current);

  const groupItems = (group: SidebarGroup): unknown =>
    group.items.map((item) => {
      const kids = item.children ?? [];
      if (kids.length === 0) return <Link item={item} active={item.href === active} />;

      // An item holding the current page opens regardless of its default, so
      // navigating never hides where you are.
      const holdsActive = kids.some((c) => c.href === active) || item.href === active;
      return (
        <div x-data={`{ open: ${holdsActive ? "true" : "false"} }`}>
          <button
            type="button"
            x-on:click="open = !open"
            {...{ "x-bind:aria-expanded": "open" }}
            class={cn(linkClass, "w-full text-muted-foreground hover:text-foreground")}
          >
            {item.icon ? <span class="shrink-0">{item.icon}</span> : null}
            <span class="flex-1 truncate text-left">{item.label}</span>
            <svg
              class="h-3.5 w-3.5 shrink-0 transition-transform"
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
          </button>
          <div
            x-show="open"
            x-cloak
            x-transition
            class="ml-3 mt-1 space-y-1 border-l border-border pl-3"
          >
            {kids.map((child) => (
              <Link item={child} active={child.href === active} />
            ))}
          </div>
        </div>
      );
    });

  const headingClass =
    "px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70";

  const nav = (
    <nav class="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((group) => {
        if (!group.label) return <div class="space-y-1">{groupItems(group)}</div>;

        // A group holding the current page is never folded shut, whatever it
        // asked for — hiding the page someone is on is the one unacceptable
        // outcome of a collapsible group.
        const holdsActive = group.items.some(
          (i) => i.href === active || (i.children ?? []).some((c) => c.href === active),
        );

        return collapsibleGroups ? (
          <details
            class="group/nav space-y-1"
            {...(group.collapsed && !holdsActive ? {} : { open: true })}
          >
            <summary
              class={cn(
                headingClass,
                "flex cursor-pointer items-center justify-between [&::-webkit-details-marker]:hidden",
              )}
            >
              {group.label}
              <svg
                class="h-3.5 w-3.5 transition-transform group-open/nav:rotate-180"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div class="space-y-1">{groupItems(group)}</div>
          </details>
        ) : (
          <div class="space-y-1">
            <p class={headingClass}>{group.label}</p>
            {groupItems(group)}
          </div>
        );
      })}
    </nav>
  );

  const panel = (
    <>
      {brand ? (
        <a
          href={brandHref}
          navigate
          class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4"
        >
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold">{brand}</span>
            {tagline ? (
              <span class="block truncate text-[11px] text-muted-foreground">{tagline}</span>
            ) : null}
          </span>
        </a>
      ) : null}
      {beforeNav}
      {nav}
      {afterNav}
      {footer ? <div class="shrink-0 border-t border-border p-3">{footer}</div> : null}
    </>
  );

  if (!collapsible) {
    return (
      <aside class={cn("flex w-64 flex-col border-r border-border bg-card", cls)} {...rest}>
        {panel}
      </aside>
    );
  }

  return (
    <div
      x-data="{ open: false }"
      // Closed by any link inside it, delegated from the container rather than
      // wired per link — a drawer left covering the page it just navigated to is
      // the classic omission, and one handler cannot be forgotten on one item.
      // Delegation also fires immediately rather than after the fetch settles.
      {...{ "x-on:click": "if ($event.target.closest('a[href]')) open = false" }}
      {...rest}
    >
      <button
        type="button"
        x-on:click="open = true"
        aria-label="Open navigation"
        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-accent lg:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* Backdrop, mobile only. */}
      <div
        x-show="open"
        x-cloak
        {...{ "x-transition.opacity": true }}
        x-on:click="open = false"
        class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      />

      <aside
        class={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform",
          // Off-canvas on small screens, always present from lg up.
          "-translate-x-full lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen",
          cls,
        )}
        {...{ "x-bind:class": "open && 'translate-x-0'" }}
      >
        {panel}
      </aside>
    </div>
  );
}
