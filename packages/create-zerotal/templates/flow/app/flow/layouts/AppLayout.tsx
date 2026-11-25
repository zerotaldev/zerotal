import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { AppLogo } from "../components/AppLogo";
import { Avatar } from "../components/Avatar";
import { Dropdown } from "../components/Dropdown";
import { Icon } from "../components/Icon";
import { ThemeToggle } from "../components/ThemeToggle";
import { Toasts } from "../components/Toasts";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import type { Shell } from "../lib/page";
import { DOCS_URL } from "../lib/site";

/**
 * The signed-in shell: a sidebar on wide screens, a top bar with a slide-out menu on
 * narrow ones. Every page behind sign-in renders inside it.
 *
 *   override layout(page: HtmlNode) {
 *     return <AppLayout shell={this.shell()}>{page}</AppLayout>;
 *   }
 *
 * Add a section of the app by adding a line to `NAV`.
 */

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "grid" },
  { label: "Projects", href: "/projects", icon: "folder" },
];

function isActive(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

function Navigation({ path }: { path: string }): HtmlNode {
  const link = (item: NavItem) => {
    const active = isActive(path, item.href);
    return (
      <a
        href={item.href}
        aria-current={active ? "page" : undefined}
        class={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon name={item.icon} class="size-4.5 shrink-0" />
        {item.label}
      </a>
    );
  };

  return (
    <nav aria-label="Main" class="flex flex-1 flex-col gap-1">
      {NAV.map(link)}
      <div class="mt-auto flex flex-col gap-1 pt-6">
        {link({ label: "Settings", href: "/settings", icon: "settings" })}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="external-link" class="size-4.5 shrink-0" />
          Documentation
        </a>
      </div>
    </nav>
  );
}

function UserMenu({ user, side }: { user: Shell["user"]; side: "top" | "bottom" }): HtmlNode {
  if (!user) return { html: "" };

  return (
    <Dropdown
      label="Account"
      side={side}
      align={side === "top" ? "start" : "end"}
      class={side === "top" ? "w-full" : undefined}
      header={
        <>
          <p class="truncate text-sm font-medium">{user.name}</p>
          <p class="truncate text-xs text-muted-foreground">{user.email}</p>
        </>
      }
      items={[
        { label: "Settings", href: "/settings", icon: "settings" },
        { label: "Sign out", post: route("logout.store"), icon: "log-out" },
      ]}
      trigger={
        side === "top" ? (
          <span class="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted">
            <Avatar name={user.name} />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{user.name}</span>
              <span class="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <Icon name="chevron-down" class="size-4 shrink-0 text-muted-foreground" />
          </span>
        ) : (
          <Avatar name={user.name} />
        )
      }
    />
  );
}

function Sidebar({ shell, closable = false }: { shell: Shell; closable?: boolean }): HtmlNode {
  return (
    <div class="flex h-full flex-col gap-6 p-4">
      <div class="flex items-center justify-between gap-2 px-2 pt-1">
        <a href={route("dashboard")} class="min-w-0 rounded-lg">
          <AppLogo />
        </a>
        <div class="flex items-center gap-2">
          <ThemeToggle />
          {closable ? (
            <button
              type="button"
              data-close-modal=""
              aria-label="Close menu"
              class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="close" class="size-4.5" />
            </button>
          ) : null}
        </div>
      </div>
      <Navigation path={shell.path} />
      <div class="border-t border-border pt-4">
        <UserMenu user={shell.user} side="top" />
      </div>
    </div>
  );
}

export function AppLayout({ shell, children }: { shell: Shell; children?: unknown }): HtmlNode {
  return (
    <div data-flow-layout="app" class="min-h-dvh lg:pl-64">
      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* Wide screens: a fixed sidebar. */}
      <aside class="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-card/60 backdrop-blur lg:block">
        <Sidebar shell={shell} />
      </aside>

      {/* Narrow screens: a top bar, and the same sidebar in a drawer. */}
      <header class="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          data-open-modal="app-menu"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="app-menu"
          class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="menu" class="size-4.5" />
        </button>
        <a href={route("dashboard")} class="min-w-0 flex-1 rounded-lg">
          <AppLogo />
        </a>
        <UserMenu user={shell.user} side="bottom" />
      </header>

      {/* A modal <dialog>: focus moves into it, the page behind is inert, and Escape closes it. */}
      <dialog
        id="app-menu"
        data-modal=""
        aria-label="Menu"
        class="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-card p-0 text-card-foreground backdrop:bg-black/50 lg:hidden"
      >
        <Sidebar shell={shell} closable />
      </dialog>

      <main id="main" class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>

      <Toasts flash={shell.flash} />
    </div>
  );
}
