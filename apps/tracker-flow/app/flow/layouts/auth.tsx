import { Flash, Layout, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { asset } from "zerotal/assets";
import { activeLocale, activeTheme } from "../../../bootstrap/app.ts";

/**
 * The shell for signing in, registering and resetting a password.
 *
 * One column, centred, `max-w-sm`, no navigation — a person on this screen has
 * one thing to do, and a header offering five others is five ways not to do it.
 * Matches the other two builds class for class, so the three are comparable
 * side by side.
 */
export class AuthLayout extends Layout {
  static override get head(): string {
    return `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/zt.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${asset("/css/app.css")}">
  `;
  }

  override render(slot: HtmlNode) {
    // See the note in app.tsx: Flow hardcodes `<html lang="en">`, so these live
    // on the wrapper.
    const theme = activeTheme() === "dark" ? "dark " : "";

    return (
      <div
        lang={activeLocale()}
        class={`${theme}flex min-h-dvh flex-col bg-background text-foreground`}
      >
        <header class="flex h-16 shrink-0 items-center px-4 sm:px-6">
          <Link href="/" current={false} class="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              class="grid size-6 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
            >
              T
            </span>
            <span class="text-sm">Tracker</span>
          </Link>
        </header>

        <main class="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
          <div class="w-full max-w-sm">
            <Flash class="mb-5" />
            {slot}
          </div>
        </main>
      </div>
    );
  }
}
