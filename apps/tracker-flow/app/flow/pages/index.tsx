import { Component } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { MarketingLayout } from "../layouts/marketing.tsx";
import { CARD } from "../ui.ts";

/**
 * The copy, in English, at the point it is rendered.
 *
 * Same decision as the other two builds: the sentences live in the file that
 * shows them rather than behind `home.routing.heading`, so a grep for a line a
 * reader quoted finds this array. `__()` translates them where they are used —
 * the string is its own catalog key.
 */
const DOCS_URL = "https://github.com/zerotal/zerotal";
const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

const FEATURES = [
  {
    href: docs("flow/routing.md"),
    heading: "File-based routing",
    body: "Every file under `app/flow/pages` is a URL. Export a `Component` subclass and the page exists — there is no registration list to keep in sync.",
  },
  {
    href: docs("flow/index.md"),
    heading: "State that lives on the server",
    body: "A page is a class. Its properties are the state, its methods are the actions, and the browser calls them over a socket — with no API to write and no store to keep in step.",
  },
  {
    href: docs("flow/forms.md"),
    heading: "Validation as you type",
    body: "`@validate` puts the rule on the property. A field bound `live` is checked against that same server-side rule on each keystroke — one definition, no validator shipped to the browser.",
  },
  {
    href: docs("orm/index.md"),
    heading: "An ORM you can read",
    body: "Models, relationships, migrations, factories, and a query builder that still looks like the query you meant to write.",
  },
  {
    href: docs("queue.md"),
    heading: "Background work, built in",
    body: "Push a job onto a queue or put it on a schedule. Same app, same types, one `bun zt worker` away.",
  },
  {
    href: docs("i18n.md"),
    heading: "Translated without a build step",
    body: '`__("Email")` — the English sentence is the key, so the source language needs no catalog and an untranslated string still reads.',
  },
];

/**
 * GET / — the public page, and the only route here a guest can reach.
 *
 * No `middleware` export: this is the one page in the app that does not require
 * a session. It is also the only page whose `render()` reads nothing at all —
 * there is no `onMount`, no query, and no state, which is what a Flow component
 * with nothing to be reactive about should look like.
 */
export class HomePage extends Component {
  static layout = MarketingLayout;
  static title = "Everything in one TypeScript app";

  async render(): Promise<HtmlNode> {
    return (
      <div>
        <section class="mx-auto max-w-3xl text-center">
          <span class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true" class="inline-flex size-1.5 rounded-full bg-success" />
            {__("The install worked")}
          </span>

          <h1 class="mt-6 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            {__("Everything in one TypeScript app")}
          </h1>

          <p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
            {__(
              "Routes, pages, validation and data access share one language and one process — served by Bun.",
            )}
          </p>

          <p class="mt-8 text-sm text-muted-foreground">
            {__("Edit {file} and the page reloads itself.", {
              file: "app/flow/pages/index.tsx",
            })}
          </p>
        </section>

        <section class="mt-20 sm:mt-28">
          <h2 class="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            {__("What you already have")}
          </h2>

          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div class={`${CARD} p-5`}>
                <h3 class="text-[0.9375rem] font-semibold text-card-foreground">
                  <a href={feature.href} target="_blank" rel="noreferrer" class="hover:text-primary">
                    {__(feature.heading)}
                  </a>
                </h3>
                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{__(feature.body)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }
}
