import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ThemeToggle } from "../components/ThemeToggle";
import { Toasts } from "../components/Toasts";
import { cn } from "../lib/cn";
import type { Shell } from "../lib/page";
import { DOCS_URL } from "../lib/site";

/**
 * The public site's shell — decorative backdrop, sticky header with active-aware
 * navigation, and a footer. The marketing pages and the error page use it; signed-in
 * pages use AppLayout, and the sign-in screens AuthLayout.
 *
 *   override layout(page: HtmlNode) {
 *     return <PublicLayout shell={this.shell()}>{page}</PublicLayout>;
 *   }
 *
 * Header, content and footer all share the same `max-w-5xl px-6` container, so the nav
 * and the page body line up at every breakpoint. Pages that want a narrower measure wrap
 * their own content rather than changing this one.
 */

// No "Home" entry: the logo is the link home.
const NAV = [{ href: "/about", label: "About" }];

const CONTAINER = "mx-auto w-full max-w-5xl px-6";

function isActive(path: string, href: string): boolean {
  return path.startsWith(href);
}

export function PublicLayout({ shell, children }: { shell: Shell; children?: unknown }): HtmlNode {
  const signedIn = shell.user !== null;

  const navLink = (href: string) =>
    cn(
      "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isActive(shell.path, href)
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  const navItems = NAV.map((item) => (
    <a
      href={item.href}
      aria-current={isActive(shell.path, item.href) ? "page" : undefined}
      class={navLink(item.href)}
    >
      {item.label}
    </a>
  ));

  return (
    <div data-flow-layout="public" class="relative flex min-h-dvh flex-col">
      {/* Decorative only: the grid and the glow. Fixed, inert, and behind everything. */}
      <div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div class="absolute inset-0 bg-grid" />
        <div class="absolute inset-x-0 top-0 h-136 bg-aurora" />
      </div>

      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      <header class="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
        <div class={cn(CONTAINER, "flex h-16 items-center justify-between gap-4")}>
          <a
            href={route("home")}
            class="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
            aria-label={`${shell.appName} home`}
          >
            <img src="/zt.svg" alt="" class="size-8 shrink-0 rounded-lg" />
            <span class="truncate">{shell.appName}</span>
          </a>

          {/* Everything but the logo sits on the right: the site's pages, then the actions. */}
          <div class="flex items-center gap-2">
            <nav aria-label="Main" class="hidden items-center gap-1 sm:flex">
              {navItems}
            </nav>
            <span aria-hidden="true" class="mx-1 hidden h-5 w-px bg-border sm:block" />
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              class="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
            >
              Docs
            </a>
            <ThemeToggle />
            {/* The next useful step, rather than a link that would bounce them. */}
            {signedIn ? (
              <Button href={route("dashboard")} size="sm" class="hidden sm:inline-flex">
                Dashboard
              </Button>
            ) : (
              <>
                <a
                  href={route("login")}
                  class="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:block"
                >
                  Sign in
                </a>
                <Button href={route("register")} size="sm" class="hidden sm:inline-flex">
                  Get started
                </Button>
              </>
            )}
            {/* Shows and hides #mobile-nav (resources/js/lib/disclosures.ts). */}
            <button
              type="button"
              data-disclosure="mobile-nav"
              aria-expanded="false"
              aria-controls="mobile-nav"
              aria-label="Open menu"
              data-label-open="Close menu"
              data-label-closed="Open menu"
              class="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
            >
              <span data-when-closed="">
                <Icon name="menu" class="size-4.5" />
              </span>
              <span data-when-open="" hidden>
                <Icon name="close" class="size-4.5" />
              </span>
            </button>
          </div>
        </div>

        <nav
          id="mobile-nav"
          aria-label="Main"
          hidden
          class={cn(CONTAINER, "flex flex-col gap-1 border-t border-border py-3 sm:hidden")}
        >
          {navItems}
          {signedIn ? (
            <a href={route("dashboard")} class={navLink("/dashboard")}>
              Dashboard
            </a>
          ) : (
            <>
              <a href={route("login")} class={navLink("/login")}>
                Sign in
              </a>
              <a href={route("register")} class={navLink("/register")}>
                Get started
              </a>
            </>
          )}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Docs
          </a>
        </nav>
      </header>

      <main id="main" class={cn(CONTAINER, "flex-1 py-14 sm:py-20")}>
        {children}
      </main>

      <footer class="border-t border-border">
        <div
          class={cn(
            CONTAINER,
            "flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row",
          )}
        >
          <p>
            Built with <span class="font-medium text-foreground">Zerotal</span> — the Bun-native
            TypeScript framework.
          </p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            class="font-medium transition-colors hover:text-foreground"
          >
            Documentation
          </a>
        </div>
      </footer>

      <Toasts flash={shell.flash} />
    </div>
  );
}
