import { view } from "zerotal";
import { Auth } from "zerotal/auth";
import { MarketingLayout } from "../../resources/views/layouts/MarketingLayout.tsx";
import { Card } from "../../resources/views/components/Ui.tsx";

/**
 * The copy, in English, at the point it is rendered.
 *
 * Same decision as the Inertia build's `home.tsx`: the sentences live in the
 * file that shows them rather than behind `home.routing.heading`, so a grep for
 * a line a reader quoted finds this array. `__()` translates them where they are
 * used — the string is its own catalog key.
 */
const DOCS_URL = "https://github.com/zerotal/zerotal";
const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

const FEATURES = [
  {
    href: docs("routing.md"),
    heading: "File-based routing",
    body: "Every file under `app/routes` is a URL. Export a `GET` or `POST` function and the route exists — there is no registration list to keep in sync.",
  },
  {
    href: docs("view.md"),
    heading: "Server-rendered JSX",
    body: "A route returns markup directly with `view()`. No client bundle, no hydration, no API layer — the response is the page.",
  },
  {
    href: docs("validator.md"),
    heading: "Validation that comes back",
    body: "`validate()` returns typed data on success. On failure it flashes the errors and the submitted input and sends the user back — the form repopulates itself.",
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
 * No props and no `title` passed in: the page owns its own copy and reads every
 * line through the same catalog, so nothing is half-translated on the server and
 * half in the browser.
 */
export const GET = async () => {
  const signedIn = Boolean(Auth.userOrNull());

  view(
    <MarketingLayout title={__("Everything in one TypeScript app")} signedIn={signedIn}>
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
          {__("Edit {file} and the page reloads itself.", { file: "app/routes/index.tsx" })}
        </p>
      </section>

      <section class="mt-20 sm:mt-28">
        <h2 class="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {__("What you already have")}
        </h2>

        <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card class="p-5">
              <h3 class="text-[0.9375rem] font-semibold text-card-foreground">
                <a href={feature.href} target="_blank" rel="noreferrer" class="hover:text-primary">
                  {__(feature.heading)}
                </a>
              </h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{__(feature.body)}</p>
            </Card>
          ))}
        </div>
      </section>
    </MarketingLayout>,
  );
};
