import { Flash, Layout, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { asset } from "zerotal/assets";
import { Auth } from "zerotal/auth";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";

/**
 * The signed-in shell.
 *
 * Deliberately the same *shape* as the other two builds — same 240px rail, same
 * 64px header, same 1280px content column, same tokens — because the cookbook's
 * claim is that all three look alike and differ only in mechanism.
 *
 * What differs here is that the shell is rendered once and then *stays*. Flow
 * patches the page over a socket, so navigating between pages replaces the slot
 * without the rail being torn down and rebuilt — the same persistence the
 * Inertia build gets from a client router, with no client router.
 */
export class AppLayout extends Layout {
  // A getter rather than a static field, so `asset()` re-runs per request and
  // picks up the latest `?v=` token after a dev rebuild.
  //
  // `/app.js` carries the stylesheet import and nothing else now. It used to
  // publish `window.Socket` too, and that made this `<script>` load-bearing in a
  // way nothing announced: Flow's `socket:` listeners were *silently inert*
  // without it, so a live feature with no script looked exactly like a live
  // feature that was never written. The runtime bundles the client itself now.
  static override get head(): string {
    return `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/zt.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${asset("/css/app.css")}">
  <script type="module" src="${asset("/app.js")}"></script>
  `;
  }

  override render(slot: HtmlNode) {
    const user = Auth.userOrNull();

    // `lang` and the theme class go on this wrapper rather than on `<html>`,
    // because Flow assembles the document itself and hardcodes
    // `<html lang="en">` with no hook to change it (see router.ts). Both
    // attributes are valid on a div and apply to everything inside, so the page
    // is correct — but the *document* still declares English, which is wrong for
    // an isiZulu reader and is a framework gap rather than a choice made here.
    //
    // The dark variant is `&:where(.dark, .dark *)`, so a class on this wrapper
    // reaches every descendant exactly as one on `<html>` would.
    const theme = activeTheme() === "dark" ? "dark " : "";

    const nav = [
      { href: "/dashboard", label: __("Dashboard") },
      { href: "/projects", label: __("Projects") },
      { href: "/activity", label: __("Activity") },
    ];

    // `data-current` is set by Flow on the <Link> matching the current URL, so
    // the active style needs no `active` prop threaded down from each page.
    const item =
      "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors " +
      "hover:bg-muted hover:text-foreground data-[current]:bg-accent data-[current]:text-accent-foreground";

    return (
      <div lang={activeLocale()} class={`${theme}min-h-dvh bg-background text-foreground`}>
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
        >
          {__("Skip to content")}
        </a>

        <aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card lg:flex">
          <div class="flex h-16 shrink-0 items-center px-4">
            <Link
              href="/projects"
              current={false}
              class="flex items-center gap-2 font-semibold tracking-tight"
            >
              <span
                aria-hidden="true"
                class="grid size-6 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
              >
                T
              </span>
              <span class="text-sm">Tracker</span>
            </Link>
          </div>

          <nav aria-label={__("Main")} class="flex-1 space-y-5 px-3 pb-4">
            <div>
              <p class="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {__("Workspace")}
              </p>
              <ul class="space-y-0.5">
                {nav.map((n) => (
                  <li>
                    <Link href={n.href} hover class={item}>
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p class="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {__("Account")}
              </p>
              <ul class="space-y-0.5">
                <li>
                  <Link href="/profile" hover class={item}>
                    {__("Profile")}
                  </Link>
                </li>
              </ul>
            </div>
          </nav>

          {user ? (
            <div class="shrink-0 border-t border-border p-4">
              <p class="truncate text-sm font-medium">{user.name}</p>
              <p class="truncate text-xs text-muted-foreground">{user.email}</p>
              {/* A POST, because a link that signs you out can be triggered by
                  any page that makes your browser fetch it. */}
              <form method="post" action="/logout" class="mt-3">
                <button
                  type="submit"
                  class="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {__("Sign out")}
                </button>
              </form>
            </div>
          ) : null}
        </aside>

        <div class="lg:pl-60">
          <header class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
            <nav aria-label={__("Main")} class="flex items-center gap-1 lg:hidden">
              {nav.map((n) => (
                <Link
                  href={n.href}
                  hover
                  class="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground data-[current]:bg-accent data-[current]:text-accent-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>

          <main id="main" class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {/* Flow's own flash component. Unlike the view build's inline
                paragraph, this one can fade itself out — there is a runtime
                here to run the timer. */}
            <Flash class="mb-6" />
            {slot}
          </main>
        </div>
      </div>
    );
  }
}
