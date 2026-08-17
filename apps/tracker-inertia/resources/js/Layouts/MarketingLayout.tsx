import type { ReactNode } from "react";
import { usePage } from "@inertiajs/react";
import FlashToasts from "../Components/FlashToasts";
import ThemeToggle from "../Components/ThemeToggle";
import Brand from "../Components/Brand";
import { ButtonLink, buttonClass } from "../Components/Button";
import LanguagePicker from "../Components/LanguagePicker";
import { APP_NAME, DOCS_URL } from "../lib/site";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

/**
 * The shell for the public page.
 *
 * Separate from {@link AppShell} because a front door and a dashboard answer
 * different questions — "what is this" against "where am I in it" — but built
 * from the same mark, the same buttons, the same borders and the same tokens, so
 * the answer to "is this the same product" is never in doubt.
 *
 * Chrome uses the app's container and padding scale, so the logo sits at the
 * same x-position here as it does in the rail. Only the hero inside is narrower,
 * which is a measure decision rather than a different layout.
 *
 * The decoration is one faint grid and one static wash, both behind everything
 * and both inert. The authenticated side has neither.
 */

const CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const signedIn = Boolean(usePage<SharedProps>().props.auth?.user);
  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground">
      {/* Decorative only. Fixed, inert, and behind everything. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute inset-x-0 top-0 h-120 bg-glow" />
      </div>

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        {__("Skip to content")}
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className={cn(CONTAINER, "flex h-16 items-center justify-between gap-4")}>
          <Brand href="/" />

          <div className="flex items-center gap-2">
            {/* Wrapped rather than given `hidden sm:…` directly: `buttonClass`
                already sets `inline-flex`, and `cn` is a plain join, so the two
                unprefixed display utilities would race — and `inline-flex` wins,
                leaving the "hidden" ones stubbornly visible. The wrapper has no
                display class of its own, so there is nothing to race. */}
            <span className="hidden sm:block">
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
                {__("Docs")}
              </a>
            </span>

            <LanguagePicker className="hidden sm:flex" />
            <ThemeToggle />

            {signedIn ? (
              <ButtonLink href={route("projects")}>{__("Open Tracker")}</ButtonLink>
            ) : (
              <>
                <ButtonLink href={route("login")} variant="secondary">
                  {__("Sign in")}
                </ButtonLink>
                <span className="hidden sm:block">
                  <ButtonLink href={route("register")}>{__("Get started")}</ButtonLink>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className={cn(CONTAINER, "flex-1 py-16 sm:py-24")}>
        {children}
      </main>

      <footer className="border-t border-border">
        <div
          className={cn(
            CONTAINER,
            "flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row",
          )}
        >
          <p>{__("Built with {name} — the Bun-native TypeScript framework.", { name: "Zerotal" })}</p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium transition-colors hover:text-foreground"
          >
            {__("Documentation")}
          </a>
          <LanguagePicker className="sm:hidden" />
        </div>
      </footer>

      <FlashToasts />
    </div>
  );
}
