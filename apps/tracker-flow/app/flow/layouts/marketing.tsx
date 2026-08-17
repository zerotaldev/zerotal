import { Layout, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { asset } from "zerotal/assets";
import { Auth } from "zerotal/auth";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";
import { PRIMARY, SECONDARY } from "../ui.ts";

const CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

/**
 * The shell for the public page.
 *
 * Separate from {@link AppLayout} because a front door and a dashboard answer
 * different questions — "what is this" against "where am I in it" — but built
 * from the same mark, buttons, borders and tokens, so whether it is the same
 * product is never in doubt.
 *
 * The language link in the footer is a plain `<a>`, not a `<Link>`. `?lang=zu`
 * has to reach the *resolver chain*, which runs in `LocaleMiddleware` on a real
 * request; a Flow navigation patches this page over the existing socket and
 * never re-enters that middleware, so the locale would not change. A full page
 * load is the mechanism, and here it is also the honest one.
 */
export class MarketingLayout extends Layout {
  static override get head(): string {
    return `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/zt.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${asset("/css/app.css")}">
  `;
  }

  override render(slot: HtmlNode) {
    // See the note in app.tsx: Flow assembles the document and hardcodes
    // `<html lang="en">`, so `lang` and the theme class live on this wrapper.
    const theme = activeTheme() === "dark" ? "dark " : "";
    const signedIn = Boolean(Auth.userOrNull());

    return (
      <div
        lang={activeLocale()}
        class={`${theme}relative flex min-h-dvh flex-col bg-background text-foreground`}
      >
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
        >
          {__("Skip to content")}
        </a>

        <header class="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
          <div class={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
            <Link
              href="/"
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

            <div class="flex items-center gap-2">
              {signedIn ? (
                <Link href="/projects" current={false} class={PRIMARY}>
                  {__("Open Tracker")}
                </Link>
              ) : (
                <>
                  <Link href="/login" current={false} class={SECONDARY}>
                    {__("Sign in")}
                  </Link>
                  <Link href="/register" current={false} class={PRIMARY}>
                    {__("Get started")}
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        <main id="main" class={`${CONTAINER} flex-1 py-16 sm:py-24`}>
          {slot}
        </main>

        <footer class="border-t border-border">
          <div
            class={`${CONTAINER} flex h-16 items-center justify-between gap-4 text-sm text-muted-foreground`}
          >
            <span>
              {__("Built with {name} — the Bun-native TypeScript framework.", {
                name: "Zerotal",
              })}
            </span>
            <a href="?lang=zu" class="hover:text-foreground">
              isiZulu
            </a>
          </div>
        </footer>
      </div>
    );
  }
}
