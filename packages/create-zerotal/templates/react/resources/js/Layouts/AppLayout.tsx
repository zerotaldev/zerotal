import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { Link, usePage } from "@inertiajs/react";
import { AppLogo } from "../Components/AppLogo";
import { Avatar } from "../Components/Avatar";
import { Dropdown } from "../Components/Dropdown";
import {
  ChevronDownIcon,
  CloseIcon,
  ExternalLinkIcon,
  FolderIcon,
  GridIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
} from "../Components/Icons";
import ThemeToggle from "../Components/ThemeToggle";
import Toasts from "../Components/Toasts";
import { cn } from "../lib/cn";
import { DOCS_URL } from "../lib/site";
import type { SharedProps } from "../types";

/**
 * The signed-in shell: a sidebar on wide screens, a top bar with a slide-out menu on
 * narrow ones. Every page behind sign-in renders inside it.
 *
 *   Page.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;
 *
 * Add a section of the app by adding a line to `NAV`.
 */

interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: GridIcon },
  { label: "Projects", href: "/projects", icon: FolderIcon },
];

function isActive(url: string, href: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === href || path.startsWith(`${href}/`);
}

function Navigation({ url }: { url: string }) {
  const link = (item: NavItem) => {
    const active = isActive(url, item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="size-4.5 shrink-0" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      {NAV.map(link)}
      <div className="mt-auto flex flex-col gap-1 pt-6">
        {link({ label: "Settings", href: "/settings", icon: SettingsIcon })}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLinkIcon className="size-4.5 shrink-0" />
          Documentation
        </a>
      </div>
    </nav>
  );
}

function UserMenu({ side }: { side: "top" | "bottom" }) {
  const { auth } = usePage<SharedProps>().props;
  const user = auth.user;
  if (!user) return null;

  return (
    <Dropdown
      label="Account"
      side={side}
      align={side === "top" ? "start" : "end"}
      className={side === "top" ? "w-full" : undefined}
      header={
        <>
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </>
      }
      items={[
        { label: "Settings", href: "/settings", icon: SettingsIcon },
        { label: "Sign out", href: route("logout.store"), method: "post", icon: LogOutIcon },
      ]}
      trigger={
        side === "top" ? (
          <span className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted">
            <Avatar name={user.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </span>
        ) : (
          <Avatar name={user.name} />
        )
      }
    />
  );
}

function Sidebar({ url, onClose }: { url: string; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <Link href={route("dashboard")} className="min-w-0 rounded-lg">
          <AppLogo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CloseIcon className="size-4.5" />
            </button>
          ) : null}
        </div>
      </div>
      <Navigation url={url} />
      <div className="border-t border-border pt-4">
        <UserMenu side="top" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { url } = usePage<SharedProps>();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);

  // The mobile menu is a modal <dialog>: focus moves into it, the page behind is inert,
  // and Escape closes it.
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);

  // Close it once a visit lands, so it is not left open over the new page.
  useEffect(() => setMenuOpen(false), [url]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* Wide screens: a fixed sidebar. */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-card/60 backdrop-blur lg:block">
        <Sidebar url={url} />
      </aside>

      {/* Narrow screens: a top bar, and the same sidebar in a drawer. */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MenuIcon className="size-4.5" />
        </button>
        <Link href={route("dashboard")} className="min-w-0 flex-1 rounded-lg">
          <AppLogo />
        </Link>
        <UserMenu side="bottom" />
      </header>

      <dialog
        ref={drawer}
        aria-label="Menu"
        onCancel={(event) => {
          event.preventDefault();
          setMenuOpen(false);
        }}
        onClick={(event) => {
          if (event.target === drawer.current) setMenuOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-card p-0 text-card-foreground backdrop:bg-black/50 lg:hidden"
      >
        <Sidebar url={url} onClose={() => setMenuOpen(false)} />
      </dialog>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>

      <Toasts />
    </div>
  );
}
