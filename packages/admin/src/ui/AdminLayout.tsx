/** @jsxImportSource @zerotal/flow */
// The persistent admin shell: sidebar navigation + sticky top bar + content slot.
// Pages set `static layout = AdminLayout`; on flow:navigate only the slot swaps,
// so the sidebar and theme state stay put. Dark/light is a pure-client toggle.

import { Layout } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { DropdownMenu } from "@zerotal/flow-ui";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import { adminHead } from "../theme.ts";
import { resolveRenderHooks } from "../renderHooks.ts";
import { impersonatedName } from "../impersonation.ts";
import { Icon } from "./icons.tsx";
import { Command, Toaster, Sidebar } from "@zerotal/flow-ui";
import type { CommandItem, SidebarItem, SidebarGroup } from "@zerotal/flow-ui";

/** @internal */
export class AdminLayout extends Layout {
  /**
   * The panel this shell belongs to. The base class serves whichever panel owns
   * the request; {@link makeAdminLayout} binds a specific one, which is what
   * every generated page uses so a WebSocket action can't drift to a sibling.
   */
  static panel: PanelInstance | undefined;

  /** The bound panel, or the one owning the current request. */
  protected panel(): PanelInstance {
    return (this.constructor as typeof AdminLayout).panel ?? Panel.current();
  }

  // Dynamic so app config (brand + theme/stylesheet) is reflected — the router
  // reads `LayoutClass.head` per render, after `Panel.configure(...)` has run.
  static override get head(): string {
    const cfg = (this.panel ?? Panel.current()).config();
    return adminHead(cfg.brand ?? "Admin", cfg.theme);
  }

  async render(slot: HtmlNode): Promise<HtmlNode> {
    const panel = this.panel();
    const cfg = panel.config();
    const base = panel.base();
    // Only what this user may reach — the route guard enforces the same verdict,
    // so a link that isn't drawn is also a URL that won't open.
    const nav = await panel.visibleNavigation();
    const topbarSlots = await Promise.all(
      (await panel.visibleTopbarSlots()).map((s) => s.render()),
    );
    // The app's configured menu first, then anything packages added — so a
    // contributed entry can't push Profile/Logout out of their familiar spot.
    const menuItems = [
      ...(cfg.userMenu?.items ?? []),
      ...(await panel.visibleUserMenuItems()).map((i) => ({
        label: i.label,
        href: i.href,
        icon: i.icon,
      })),
    ];

    // Unread notification count for the bell badge (refreshes each navigation).
    const notifications = panel.notificationProvider();
    let unread = 0;
    if (notifications) {
      try {
        unread =
          typeof notifications.unreadCount === "function"
            ? await notifications.unreadCount()
            : (await notifications.resolve()).filter((n) => !n.read).length;
      } catch {
        unread = 0;
      }
    }

    // Flat list of navigable destinations for the command palette. The group
    // heading rides along as a keyword, so typing a cluster's name finds the
    // resources inside it.
    const paletteItems: CommandItem[] = [];
    for (const g of nav) {
      for (const item of g.items) {
        paletteItems.push({
          label: item.label,
          href: item.href,
          ...(g.group ? { group: g.group } : {}),
        });
        for (const child of item.children ?? []) {
          paletteItems.push({
            label: child.label,
            href: child.href,
            ...(g.group ? { group: g.group } : {}),
            keywords: item.label,
          });
        }
      }
    }

    // While acting as someone else, say so on every page. A quiet impersonation
    // is how an operator forgets and does something as the wrong person.
    const actingAs = await impersonatedName();

    // Contributed chrome: banners, badges, notices. Resolved once per render so
    // a throwing hook can't take the shell down with it.
    const hook = (name: Parameters<typeof panel.renderHooks>[0]): (HtmlNode | string)[] =>
      resolveRenderHooks(panel.renderHooks(name));

    // Sidebar navigation badges (counts), resolved per resource slug.
    const badges = await panel.navigationBadges();
    const badgeTone: Record<string, string> = {
      primary: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
      success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
      muted: "bg-muted text-muted-foreground",
      destructive: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
    };

    /** One nav entry, in the shape the sidebar component takes. */
    const toItem = (item: {
      href: string;
      label: string;
      icon: string;
      slug?: string;
      external?: boolean | undefined;
      children?: Array<{
        href: string;
        label: string;
        icon: string;
        slug?: string;
        external?: boolean | undefined;
      }>;
    }): SidebarItem => {
      const badge = item.slug ? badges[item.slug] : undefined;
      return {
        label: item.label,
        href: item.href,
        icon: <Icon name={item.icon} class="h-[18px] w-[18px] shrink-0" />,
        external: item.external,
        ...(badge
          ? { badge: badge.text, badgeClass: badgeTone[badge.color] ?? badgeTone["primary"] }
          : {}),
        ...(item.children?.length ? { children: item.children.map(toItem) } : {}),
      };
    };

    const navGroups: SidebarGroup[] = [
      {
        items: [
          {
            label: "Dashboard",
            href: base,
            icon: <Icon name="home" class="h-[18px] w-[18px] shrink-0" />,
          },
        ],
      },
      ...nav.map((group) => ({
        ...(group.group ? { label: group.group } : {}),
        items: group.items.map(toItem),
      })),
    ];

    return (
      // The shell identity: two panels render different sidebars, so a navigation
      // that crosses from one to the other has to replace the shell, not just the
      // content slot.
      <div
        data-flow-layout={`admin-${panel.id}`}
        class="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16rem_1fr]"
      >
        {hook("body.start")}

        {actingAs ? (
          <div class="flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-black lg:col-span-2">
            <span>
              Acting as <strong>{actingAs}</strong>
            </span>
            <a
              href={`${base}/stop-impersonating`}
              class="rounded bg-black/15 px-2 py-0.5 font-semibold transition hover:bg-black/25"
            >
              Stop
            </a>
          </div>
        ) : null}
        {/* The nav rail. Desktop-only here — the top bar carries the mobile
            menu, so the component's own drawer is switched off. The active link
            is marked by the client router rather than passed in, which is what
            keeps it correct after a soft navigation. */}
        <Sidebar
          class="hidden border-r border-border bg-card/40 lg:flex lg:flex-col"
          collapsible={false}
          collapsibleGroups
          brand={cfg.brand}
          {...(cfg.tagline ? { tagline: cfg.tagline } : {})}
          brandHref={base}
          groups={navGroups}
          beforeNav={hook("sidebar.start")}
          afterNav={hook("sidebar.end")}
        />

        {/* ── Main column ─────────────────────────────────────────── */}
        <div class="flex min-w-0 flex-col">
          <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
            <a href={base} navigate class="lg:hidden flex items-center gap-2 font-semibold">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                {cfg.brand.slice(0, 1).toUpperCase()}
              </span>
            </a>
            {/* Global search — a plain GET form navigates to the search page;
                the ⌘K hint opens the client-side command palette. */}
            <form action={`${base}/search`} method="get" class="flex-1 max-w-md">
              <div class="relative">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Icon name="search" class="h-4 w-4" />
                </span>
                <input
                  type="search"
                  name="q"
                  placeholder="Search…"
                  class="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-12 text-sm outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onclick="window.__kPaletteOpen&&window.__kPaletteOpen()"
                  aria-label="Open command palette"
                  class="absolute inset-y-0 right-2 my-auto hidden h-6 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:inline-flex"
                >
                  ⌘K
                </button>
              </div>
            </form>
            {/* Contributed top-bar slots — status pills, health indicators, tenant
                switchers. Rendered before the panel's own controls so the bell and
                the theme toggle stay where users expect them. */}
            {hook("topbar.start")}
            {topbarSlots}
            {panel.roleProvider() ? (
              <a
                href={`${base}/roles`}
                navigate
                aria-label="Roles and permissions"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon name="shield" class="h-[18px] w-[18px]" />
              </a>
            ) : null}
            {panel.mediaProvider() ? (
              <a
                href={`${base}/media`}
                navigate
                aria-label="Media library"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon name="image" class="h-[18px] w-[18px]" />
              </a>
            ) : null}
            {notifications ? (
              <a
                href={`${base}/notifications`}
                navigate
                aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
                class="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon name="bell" class="h-[18px] w-[18px]" />
                {unread > 0 ? (
                  <span class="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
                    {unread > 99 ? "99+" : String(unread)}
                  </span>
                ) : null}
              </a>
            ) : null}
            <button
              type="button"
              onclick="window.__zerotalToggleTheme()"
              aria-label="Toggle dark mode"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon name="sun" class="hidden h-[18px] w-[18px] dark:block" />
              <Icon name="moon" class="h-[18px] w-[18px] dark:hidden" />
            </button>

            {menuItems.length > 0 ? (
              <DropdownMenu
                align="right"
                trigger={
                  <button
                    type="button"
                    aria-label="Account menu"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon name="users" class="h-[18px] w-[18px]" />
                  </button>
                }
              >
                {cfg.userMenu?.label ? (
                  <div class="px-2 py-1.5 text-sm font-semibold text-foreground">
                    {cfg.userMenu.label}
                  </div>
                ) : null}
                {cfg.userMenu?.label ? <div class="-mx-1 my-1 h-px bg-border" /> : null}
                {menuItems.map((it) => (
                  <a
                    href={it.href}
                    navigate
                    class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {it.icon ? <Icon name={it.icon} class="h-4 w-4" /> : null}
                    {it.label}
                  </a>
                ))}
              </DropdownMenu>
            ) : null}
            {hook("topbar.end")}
          </header>

          <main class="flex-1 animate-fade-in px-4 py-6 sm:px-6 lg:px-8">{slot}</main>
        </div>

        {/* Command palette. The items are the same nav tree the sidebar draws,
            so a destination can never be reachable from one and not the other. */}
        <Command
          items={paletteItems}
          placeholder="Jump to a resource…"
          emptyMessage="Nothing matches that."
        />

        {hook("body.end")}

        {/* Toast host for action flashes (delete, save, …). The themed one, so
            a toast follows the panel's palette in light and dark alike. */}
        <Toaster position="bottom-right" />
      </div>
    );
  }
}

/**
 * The shell class for one panel, cached so every page of that panel shares it.
 *
 * The router keys shell persistence on the layout class name, so each panel needs
 * a class of its own: without that, navigating from one panel to another would
 * swap the content while leaving the previous panel's sidebar in place.
 *
 * @internal
 */
export function makeAdminLayout(panel: PanelInstance): typeof AdminLayout {
  const cached = LAYOUTS.get(panel);
  if (cached) return cached;

  const PanelAdminLayout = class extends AdminLayout {
    static override panel = panel;
  };
  Object.defineProperty(PanelAdminLayout, "name", {
    value: panel.id === "admin" ? "AdminLayout" : `AdminLayout_${panel.id}`,
  });
  LAYOUTS.set(panel, PanelAdminLayout);
  return PanelAdminLayout;
}

const LAYOUTS = new WeakMap<PanelInstance, typeof AdminLayout>();

/** Self-contained command-palette controller (open/close, filter, keyboard nav). */
