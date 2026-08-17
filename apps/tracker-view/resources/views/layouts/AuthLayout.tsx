import type { FC } from "zerotal/view";
import { asset } from "zerotal/assets";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";

interface AuthLayoutProps extends Record<string, unknown> {
  title: string;
  subtitle?: string | undefined;
  flash?: { success?: string | null; error?: string | null } | undefined;
  footer?: { text: string; link: string; href: string } | undefined;
  children?: unknown;
}

/**
 * The shell for signing in, registering and resetting a password.
 *
 * One column, centred, `max-w-sm`, no navigation — a person on this screen has
 * one thing to do. Matches the Inertia build's `AuthLayout` class for class, so
 * the two screens are comparable side by side.
 *
 * No theme toggle. The Inertia version has one because it can flip a class on
 * `<html>` from a click handler; this build has no handlers, and a toggle that
 * needs a round trip to change a colour is worse than not offering it. That is a
 * real divergence, and it belongs in the recipe rather than being papered over.
 */
export const AuthLayout: FC<AuthLayoutProps> = ({ title, subtitle, flash, footer, children }) => (
  <html lang={activeLocale()} class={activeTheme() === "dark" ? "dark" : undefined}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} — Tracker</title>
      <link rel="icon" href="/zt.svg" type="image/svg+xml" />
      <link rel="stylesheet" href={asset("app.css")} />
    </head>

    <body class="flex min-h-dvh flex-col bg-background text-foreground">
      <header class="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            class="grid size-6 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
          >
            T
          </span>
          <span class="text-sm">Tracker</span>
        </a>
      </header>

      <main class="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        <div class="w-full max-w-sm">
          <div class="text-center">
            <h1 class="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p class="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>

          {flash?.error ? (
            <p
              role="alert"
              class="mt-6 rounded-md border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive"
            >
              {flash.error}
            </p>
          ) : null}

          <div class="mt-6 rounded-xl border border-border bg-card p-6">{children}</div>

          {footer ? (
            <p class="mt-5 text-center text-sm text-muted-foreground">
              {footer.text}{" "}
              <a href={footer.href} class="font-medium text-primary hover:underline">
                {footer.link}
              </a>
            </p>
          ) : null}
        </div>
      </main>
    </body>
  </html>
);
