import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { AppLayout } from "../layouts/AppLayout";
import { PublicLayout } from "../layouts/PublicLayout";
import { buttonClass } from "../lib/button";
import type { IconName } from "../lib/icons";
import { Page } from "../lib/page";
import { appName } from "../lib/site";
import { icon } from "../lib/ui";

/**
 * The page behind every HTTP error the app renders to a browser.
 *
 * `app/exceptions/Handler.ts` picks the status and renders this component, so a missing
 * URL lands inside the app's own shell instead of on a bare framework page — the sidebar
 * for someone signed in, the public header for everyone else. In development the
 * framework's stack-trace page still wins for 500s; this is what production shows.
 *
 * It has no route of its own: the handler sets `status` and renders it directly.
 */

const COPY: Record<number, { heading: string; body: string; icon: IconName }> = {
  403: {
    heading: "You don't have access to this",
    body: "This page exists, but it belongs to someone else. If you think that is wrong, ask whoever shared the link.",
    icon: "lock",
  },
  404: {
    heading: "Page not found",
    body: "Nothing lives at this address. It may have moved, or the link may have a typo in it.",
    icon: "search",
  },
  419: {
    heading: "This page expired",
    body: "The form sat open long enough for its security token to run out. Reload the page and send it again.",
    icon: "clock",
  },
  429: {
    heading: "Slow down a little",
    body: "That was a lot of requests in a short time. Wait a moment, then try again.",
    icon: "clock",
  },
  500: {
    heading: "Something went wrong on our side",
    body: "The error has been logged. Try again in a moment — if it keeps happening, let us know.",
    icon: "alert",
  },
  503: {
    heading: "Down for maintenance",
    body: "We are making some changes. The app will be back shortly.",
    icon: "clock",
  },
};

const FALLBACK = COPY[500]!;

export class ErrorPage extends Page {
  status = 404;

  static override title = (page: ErrorPage): string => {
    const name = appName();
    const heading = page.copy().heading;
    return name ? `${heading} — ${name}` : heading;
  };

  copy(): { heading: string; body: string; icon: IconName } {
    return COPY[this.status] ?? FALLBACK;
  }

  /** The shell the visitor was already in: the sidebar once signed in, the public header before. */
  override layout(page: HtmlNode): HtmlNode {
    const shell = this.shell();
    return shell.user ? (
      <AppLayout shell={shell}>{page}</AppLayout>
    ) : (
      <PublicLayout shell={shell}>{page}</PublicLayout>
    );
  }

  override async render(): Promise<HtmlNode> {
    const { heading, body, icon: name } = this.copy();
    const status = this.status;
    const signedIn = this.user !== null;

    return (
      <section class="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-16">
        <div class="grid size-14 place-items-center rounded-2xl border border-border bg-accent text-accent-foreground">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="size-7"
            dangerouslySetInnerHTML={icon(name)}
          />
        </div>

        <p class="mt-6 font-mono text-sm font-semibold tracking-widest text-primary">
          ERROR {status}
        </p>
        <h1 class="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{heading}</h1>
        <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">{body}</p>

        <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {status === 419 ? (
            <button type="button" class={buttonClass("primary", "md")} data-action="reload">
              Reload the page
            </button>
          ) : (
            <a href={signedIn ? route("dashboard") : route("home")} class={buttonClass()}>
              {signedIn ? "Go to the dashboard" : "Back to home"}
            </a>
          )}
          <button type="button" class={buttonClass("secondary", "md")} data-action="back">
            Go back
          </button>
        </div>
      </section>
    );
  }
}
