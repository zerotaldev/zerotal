import type { ReactNode } from "react";
import { Link, usePage } from "@inertiajs/react";
import FlashToasts from "../Components/FlashToasts";
import ThemeToggle from "../Components/ThemeToggle";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

/**
 * The signed-in shell: a fixed rail and a content column.
 *
 * Separate from `AppLayout`, which is the marketing shell for the public pages.
 * They answer different questions — one is "what is this product", the other is
 * "where am I in it" — and one layout doing both ends up doing neither.
 *
 * The rail stays neutral on purpose. A saturated sidebar competes with the
 * status and priority badges, which are the only colour in this app that carries
 * information.
 *
 * Used as an Inertia persistent layout, so the rail mounts once and survives
 * navigation; only the content column re-renders.
 */

const NAV = [
  { href: "/projects", label: "Projects" },
  { href: "/profile", label: "Settings" },
];

function isActive(url: string, href: string): boolean {
  return url === href || url.startsWith(`${href}/`);
}

export default function TrackerLayout({ children }: { children: ReactNode }) {
  const { url, props } = usePage<SharedProps>();
  const user = props.auth?.user;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Rail. Hidden below `lg`, where the top bar carries the same links. */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center gap-2 px-5">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          <Link href="/projects" className="text-sm font-semibold tracking-tight">
            Tracker
          </Link>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-0.5 px-3 py-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(url, item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(url, item.href)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {user && (
          <div className="border-t border-border px-5 py-3">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          {/* Below `lg` the rail is gone, so the links live here instead. */}
          <nav aria-label="Main" className="flex items-center gap-1 lg:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm font-medium",
                  isActive(url, item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/logout"
              method="post"
              as="button"
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Sign out
            </Link>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>

      <FlashToasts />
    </div>
  );
}
