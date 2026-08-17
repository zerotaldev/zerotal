import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import MarketingLayout from "../Layouts/MarketingLayout";
import { ButtonLink, buttonClass } from "../Components/Button";
import { Card, CardIcon } from "../Components/Card";
import { Command } from "../Components/Code";
import Rich from "../Components/Rich";
import {
  ArrowRightIcon,
  ClockIcon,
  DatabaseIcon,
  FolderIcon,
  LayersIcon,
  ShieldIcon,
  TerminalIcon,
} from "../Components/Icons";
import { DOCS_URL } from "../lib/site";

const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

/**
 * The copy lives here, in English, rather than behind `home.routing.heading`.
 *
 * These used to be key fragments interpolated into `home.${key}.heading`, which
 * meant nothing could find them: neither a grep for the sentence nor a reader of
 * this file could tell what the card said without opening the catalog. Now the
 * card holds its own words and `__()` translates them where they are used.
 */
const FEATURES = [
  {
    icon: FolderIcon,
    href: docs("routing.md"),
    heading: "File-based routing",
    body: "Every file under `app/routes` is a URL. Export a `GET` or `POST` function and the route exists — there is no registration list to keep in sync.",
  },
  {
    icon: LayersIcon,
    href: docs("inertia.md"),
    heading: "Pages, not endpoints",
    body: 'A route returns `Inertia.render("home", props)` and this component receives them as React props. No API layer in between to build, version or keep in step.',
  },
  {
    icon: ShieldIcon,
    href: docs("validator.md"),
    heading: "Validation that comes back",
    body: "`validate()` returns typed data on success. On failure it flashes the errors and the submitted input and sends the user back — the form repopulates itself.",
  },
  {
    icon: DatabaseIcon,
    href: docs("orm/index.md"),
    heading: "An ORM you can read",
    body: "Models, relationships, migrations, factories, and a query builder that still looks like the query you meant to write.",
  },
  {
    icon: ClockIcon,
    href: docs("queue.md"),
    heading: "Background work, built in",
    body: "Push a job onto a queue or put it on a schedule. Same app, same types, one `bun zt worker` away.",
  },
  {
    icon: TerminalIcon,
    href: docs("commands.md"),
    heading: "A CLI that writes the boilerplate",
    body: "`make:page`, `make:controller`, `route:list`, `repl` — and `make:command` when you need one of your own.",
  },
];

const NEXT_STEPS = [
  { command: "bun zt route:list", text: "Every route this app registers, in one table." },
  { command: "bun zt make:page Dashboard", text: "Scaffold a page with its layout wired up." },
  { command: "bun zt test", text: "Run the suite with the application booted." },
];

/**
 * The public page.
 *
 * Same mark, same buttons, same borders and same tokens as the signed-in app —
 * it is the front of one product, not a template bolted to the front of another.
 * The heading is the only type in the codebase allowed above 24px, and it earns
 * that by being the first thing anyone reads.
 */
function Home() {
  return (
    <>
      <Head title="Home" />

      <section className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          {__("The install worked")}
        </span>

        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          {__("Everything in one TypeScript app")}
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
          {__("Routes, pages, validation and data access share one language and one process — served by Bun.")}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href={route("projects")} size="lg">
            {__("Open Tracker")}
            <ArrowRightIcon className="size-4" />
          </ButtonLink>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary", "lg")}
          >
            {__("Read the docs")}
          </a>
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          {__("Edit {file} and the page reloads itself.", { file: "resources/js/pages/home.tsx" })}
        </p>
      </section>

      <section className="mt-20 sm:mt-28">
        <h2 className="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {__("What you already have")}
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, heading, body, href }) => (
            <Card key={heading} interactive className="relative p-5">
              <CardIcon>
                <Icon className="size-4.5" />
              </CardIcon>

              <h3 className="mt-4 text-[0.9375rem] font-semibold text-card-foreground">
                {/* The pseudo-element stretches this link over the whole card, so the
                    entire surface is clickable while its accessible name stays the heading. */}
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="after:absolute after:inset-0 after:rounded-xl"
                >
                  {__(heading)}
                </a>
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <Rich text={__(body)} />
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-20 sm:mt-28">
        <h2 className="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {__("Where to go next")}
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {NEXT_STEPS.map(({ command, text }) => (
            <div key={command} className="space-y-2">
              <Command>{command}</Command>
              <p className="px-1 text-sm text-muted-foreground">{__(text)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Inertia persistent layout — preserved across client-side navigations.
(Home as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <MarketingLayout>{page}</MarketingLayout>
);

export default Home;
