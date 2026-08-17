import type { FC } from "zerotal/view";
import { asset } from "zerotal/assets";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";
import {
  ChartIcon,
  ClockIcon,
  ProjectsIcon,
  UserIcon,
} from "../components/Icons.tsx";

interface AppLayoutProps extends Record<string, unknown> {
  title: string;
  user?: { name: string; email: string } | null | undefined;
  flash?: { success?: string | null; error?: string | null } | undefined;
  active?: string | undefined;
  children?: unknown;
}

/**
 * The signed-in shell, rendered on the server.
 *
 * Deliberately the same *shape* as the Inertia build's `AppShell` — same rail,
 * same 64px header, same 1280px content column, same tokens — because the
 * cookbook's claim is that the two look alike and differ only in mechanism. What
 * it cannot share is the code: one is React, this is a string of HTML.
 *
 * There is no client JavaScript on this page at all. That is the point of this
 * build: a theme toggle that needs a listener, a drawer that needs state, and a
 * live comment thread all have to be re-thought as things a server can send —
 * and where they cannot be, the recipe says so.
 */
export const AppLayout: FC<AppLayoutProps> = ({ title, user, flash, active, children }) => {
  // Still needed for `<html lang>`, which wants the code rather than a message.
  const locale = activeLocale();

  // `route()` refuses an unregistered name at compile time, so this list cannot
  // drift ahead of the routes — every entry here is a page that exists.
  const nav = [
    { href: route("dashboard"), label: __("Dashboard"), key: "dashboard", icon: ChartIcon },
    { href: route("projects"), label: __("Projects"), key: "projects", icon: ProjectsIcon },
    { href: route("activity"), label: __("Activity"), key: "activity", icon: ClockIcon },
  ];

  // The accent colour appears on the active item's icon and nowhere else in the
  // rail, so it never competes with the status and priority badges — the only
  // colour in this app that carries information.
  const item = (
    href: string,
    label: string,
    isActive: boolean,
    Icon: FC<{ class?: string | undefined }>,
  ) => (
    <li>
      <a
        href={href}
        aria-current={isActive ? "page" : undefined}
        class={
          "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors " +
          (isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <Icon class={`size-4 shrink-0 ${isActive ? "text-primary" : "text-current"}`} />
        {label}
      </a>
    </li>
  );

  return (
    <html lang={locale} class={activeTheme() === "dark" ? "dark" : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — Tracker</title>
        <link rel="icon" href="/zt.svg" type="image/svg+xml" />
        {/* `asset()`, not a literal path. It applies the configured prefix and
            appends a `?v=` in dev, which is what makes a rebuilt stylesheet
            actually arrive instead of being served from cache. */}
        <link rel="stylesheet" href={asset("app.css")} />
      </head>

      <body class="min-h-dvh bg-background text-foreground">
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
        >
          {__("Skip to content")}
        </a>

        {/* The rail is `hidden lg:flex` in the Inertia build, where a drawer takes
            over below it. A drawer needs state, so here the rail becomes a
            horizontal bar on small screens — same destinations, no JavaScript. */}
        <aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card lg:flex">
          <div class="flex h-16 shrink-0 items-center px-4">
            <a href={route("projects")} class="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden="true"
                class="grid size-6 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
              >
                T
              </span>
              <span class="text-sm">Tracker</span>
            </a>
          </div>

          <nav aria-label={__("Main")} class="flex-1 space-y-5 px-3 pb-4">
            <div>
              <p class="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {__("Workspace")}
              </p>
              <ul class="space-y-0.5">{nav.map((n) => item(n.href, n.label, active === n.key, n.icon))}</ul>
            </div>

            <div>
              <p class="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {__("Account")}
              </p>
              <ul class="space-y-0.5">
                {item(route("profile"), __("Profile"), active === "profile", UserIcon)}
              </ul>
            </div>
          </nav>

          {user ? (
            <div class="shrink-0 border-t border-border p-4">
              <p class="truncate text-sm font-medium">{user.name}</p>
              <p class="truncate text-xs text-muted-foreground">{user.email}</p>
              {/* A POST, because a link that signs you out can be triggered by any
                  page that makes your browser fetch it. Without JavaScript that
                  means a real form — which is why this is a button, not an <a>. */}
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
                <a
                  href={n.href}
                  class={
                    "rounded-md px-2.5 py-1.5 text-sm font-medium " +
                    (active === n.key ? "bg-accent text-accent-foreground" : "text-muted-foreground")
                  }
                >
                  {n.label}
                </a>
              ))}
            </nav>
          </header>

          <main id="main" class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {/* Flash is rendered inline rather than as a floating toast: a toast
                that fades needs a timer, and there is no script to run one. An
                alert in the document is also the thing a screen reader reaches
                by reading the page. */}
            {flash?.success ? (
              <p
                role="status"
                class="mb-6 rounded-md border border-success/40 bg-card px-4 py-3 text-sm text-success"
              >
                {flash.success}
              </p>
            ) : null}
            {flash?.error ? (
              <p
                role="alert"
                class="mb-6 rounded-md border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive"
              >
                {flash.error}
              </p>
            ) : null}

            {children}
          </main>
        </div>
      </body>
    </html>
  );
};
