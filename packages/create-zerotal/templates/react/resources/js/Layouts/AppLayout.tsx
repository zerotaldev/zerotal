import { useEffect, useState, type ReactNode } from "react";
import { Link, usePage } from "@inertiajs/react";
import FlashToasts from "../Components/FlashToasts";
import ThemeToggle from "../Components/ThemeToggle";
import { CloseIcon, MenuIcon } from "../Components/Icons";
import { APP_NAME, DOCS_URL } from "../lib/site";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

/**
 * Shared application shell — decorative backdrop, sticky header with
 * active-aware navigation, and a footer.
 *
 * Use it as an Inertia persistent layout so the header survives client-side
 * navigations and only the page body re-renders:
 *
 *   Page.layout = (page) => <AppLayout>{page}</AppLayout>;
 *
 * Header, content and footer all share the same `max-w-5xl px-6` container, so
 * the nav and the page body line up at every breakpoint. Pages that want a
 * narrower measure wrap their own content rather than changing this one.
 */

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Shown to signed-in visitors and guests respectively, so the header always
// offers the next useful step rather than a link that would bounce them.
const AUTHED_NAV = [{ href: "/profile", label: "Profile" }];
const GUEST_NAV = [
  { href: "/login", label: "Sign in" },
  { href: "/register", label: "Register" },
];

const CONTAINER = "mx-auto w-full max-w-5xl px-6";

function isActive(url: string, href: string): boolean {
  return href === "/" ? url === "/" : url.startsWith(href);
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { url, props } = usePage<SharedProps>();
  const signedIn = Boolean(props.auth?.user);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu once a visit lands, otherwise it stays open on top of
  // the page the user just navigated to.
  useEffect(() => setMenuOpen(false), [url]);

  const navLink = (href: string) =>
    cn(
      "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isActive(url, href)
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  const navItems = [...NAV, ...(signedIn ? AUTHED_NAV : GUEST_NAV)].map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(url, item.href) ? "page" : undefined}
      className={navLink(item.href)}
    >
      {item.label}
    </Link>
  ));

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Decorative only: the grid and the glow. Fixed, inert, and behind everything. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute inset-x-0 top-0 h-136 bg-aurora" />
      </div>

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
        <div className={cn(CONTAINER, "flex h-16 items-center justify-between gap-4")}>
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
            aria-label={`${APP_NAME} home`}
          >
            <img src="/zt.svg" alt="" className="size-8 shrink-0 rounded-lg" />
            <span className="truncate">{APP_NAME}</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {navItems}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
            >
              Docs
            </a>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
            >
              {menuOpen ? <CloseIcon className="size-4.5" /> : <MenuIcon className="size-4.5" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className={cn(CONTAINER, "flex flex-col gap-1 border-t border-border py-3 sm:hidden")}
          >
            {navItems}
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Docs
            </a>
          </nav>
        ) : null}
      </header>

      <main id="main" className={cn(CONTAINER, "flex-1 py-14 sm:py-20")}>
        {children}
      </main>

      <footer className="border-t border-border">
        <div
          className={cn(
            CONTAINER,
            "flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row",
          )}
        >
          <p>
            Built with <span className="font-medium text-foreground">Zerotal</span> — the Bun-native
            TypeScript framework.
          </p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium transition-colors hover:text-foreground"
          >
            Documentation
          </a>
        </div>
      </footer>

      <FlashToasts />
    </div>
  );
}
