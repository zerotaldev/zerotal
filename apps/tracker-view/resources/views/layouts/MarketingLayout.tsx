import type { FC } from "zerotal/view";
import { asset } from "zerotal/assets";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";
import { buttonClass } from "../components/Ui.tsx";

interface MarketingLayoutProps extends Record<string, unknown> {
  title: string;
  signedIn?: boolean | undefined;
  children?: unknown;
}

const CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

/**
 * The shell for the public page.
 *
 * Separate from {@link AppLayout} because a front door and a dashboard answer
 * different questions — "what is this" against "where am I in it" — but built
 * from the same mark, buttons, borders and tokens, so whether it is the same
 * product is never in doubt.
 *
 * What the Inertia build has here and this one does not: a theme toggle, which
 * needs a listener to flip a class, and a language picker, which needs one to
 * submit on change. The language choice is still reachable without either —
 * `?lang=zu` is in the resolver chain, and the footer link below uses it. That
 * is the honest server-rendered version of a `<select>` that posts itself.
 */
export const MarketingLayout: FC<MarketingLayoutProps> = ({ title, signedIn, children }) => (
  <html lang={activeLocale()} class={activeTheme() === "dark" ? "dark" : undefined}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} — Tracker</title>
      <link rel="icon" href="/zt.svg" type="image/svg+xml" />
      <link rel="stylesheet" href={asset("app.css")} />
    </head>

    <body class="relative flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        {__("Skip to content")}
      </a>

      <header class="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div class={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
          <a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              class="grid size-6 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
            >
              T
            </span>
            <span class="text-sm">Tracker</span>
          </a>

          <div class="flex items-center gap-2">
            {signedIn ? (
              <a href={route("projects")} class={buttonClass("primary")}>
                {__("Open Tracker")}
              </a>
            ) : (
              <>
                <a href={route("login")} class={buttonClass("secondary")}>
                  {__("Sign in")}
                </a>
                <a href={route("register")} class={buttonClass("primary")}>
                  {__("Get started")}
                </a>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" class={`${CONTAINER} flex-1 py-16 sm:py-24`}>
        {children}
      </main>

      <footer class="border-t border-border">
        <div
          class={`${CONTAINER} flex h-16 items-center justify-between gap-4 text-sm text-muted-foreground`}
        >
          <span>{__("Built with {name} — the Bun-native TypeScript framework.", { name: "Zerotal" })}</span>
          {/* A link, not a `<select>`: switching language without JavaScript means
              navigating, and `?lang=` is the first resolver in the chain. */}
          <a href="?lang=zu" class="hover:text-foreground">
            isiZulu
          </a>
        </div>
      </footer>
    </body>
  </html>
);
