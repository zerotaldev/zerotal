import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../components/Button";
import { Card, CardIcon } from "../components/Card";
import { Code, Command } from "../components/Code";
import { Icon } from "../components/Icon";
import { PublicLayout } from "../layouts/PublicLayout";
import { buttonClass } from "../lib/button";
import type { IconName } from "../lib/icons";
import { Page, titled } from "../lib/page";
import { DOCS_URL } from "../lib/site";

const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

const FEATURES: { icon: IconName; heading: string; body: HtmlNode; href: string }[] = [
  {
    icon: "folder",
    heading: "File-based routing",
    body: (
      <>
        Every file under <Code>app/routes</Code> is a URL. Export a <Code>GET</Code> or{" "}
        <Code>POST</Code> function and the route exists — there is no registration list to keep in
        sync.
      </>
    ),
    href: docs("routing.md"),
  },
  {
    icon: "layers",
    heading: "Pages, not endpoints",
    body: (
      <>
        A page is a <Code>Component</Code> class whose <Code>render()</Code> runs on the server,
        next to the data it shows. No API layer in between to build, version or keep in step.
      </>
    ),
    href: docs("flow/index.md"),
  },
  {
    icon: "shield",
    heading: "Validation that comes back",
    body: (
      <>
        <Code>validate()</Code> returns typed data on success. On failure it flashes the errors and
        the submitted input and sends the user back — the form repopulates itself.
      </>
    ),
    href: docs("validator.md"),
  },
  {
    icon: "database",
    heading: "An ORM you can read",
    body: (
      <>
        Models, relationships, migrations, factories, and a query builder that still looks like the
        query you meant to write.
      </>
    ),
    href: docs("orm/index.md"),
  },
  {
    icon: "clock",
    heading: "Background work, built in",
    body: (
      <>
        Push a job onto a queue or put it on a schedule. Same app, same types, one{" "}
        <Code>bun zt worker</Code> away.
      </>
    ),
    href: docs("queue.md"),
  },
  {
    icon: "terminal",
    heading: "A CLI that writes the boilerplate",
    body: (
      <>
        <Code>make:flow</Code>, <Code>make:controller</Code>, <Code>route:list</Code>,{" "}
        <Code>repl</Code> — and <Code>make:command</Code> when you need one of your own.
      </>
    ),
    href: docs("commands.md"),
  },
];

const NEXT_STEPS = [
  { command: "bun zt route:list", note: "Every route this app registers, in one table." },
  {
    command: "bun zt make:flow Reports",
    note: "Scaffold a page, then give it a line in routes/web.ts.",
  },
  { command: "bun zt test", note: "Run the suite with the application booted." },
];

/** GET / — the landing page. */
export class HomePage extends Page {
  static override title = titled("Home");

  override layout(page: HtmlNode): HtmlNode {
    return <PublicLayout shell={this.shell()}>{page}</PublicLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <>
        <section class="text-center">
          <span class="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground">
            <span class="relative flex size-2">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span class="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            The install worked
          </span>

          <h1 class="mx-auto mt-6 max-w-3xl bg-linear-to-br from-foreground via-foreground to-primary bg-clip-text text-4xl font-bold tracking-tight text-balance text-transparent sm:text-6xl">
            Everything in one TypeScript app
          </h1>

          <p class="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
            Routes, pages, validation and data access share one language and one process — served by
            Bun.
          </p>

          <div class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={route("about")} size="lg">
              Take the tour
              <Icon name="arrow-right" class="size-4" />
            </Button>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              class={buttonClass("secondary", "lg")}
            >
              Read the docs
            </a>
          </div>

          <p class="mt-8 text-sm text-muted-foreground">
            Edit <Code>app/flow/pages/home.tsx</Code> and the page reloads itself.
          </p>
        </section>

        <section class="mt-20 sm:mt-28">
          <h2 class="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            What you already have
          </h2>

          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon, heading, body, href }) => (
              <Card interactive class="group relative p-5">
                <CardIcon class="transition-colors group-hover:border-primary/40">
                  <Icon name={icon} class="size-5" />
                </CardIcon>

                <h3 class="mt-4 font-semibold text-card-foreground">
                  {/* The pseudo-element stretches this link over the whole card, so the
                      entire surface is clickable while its accessible name stays the heading. */}
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    class="after:absolute after:inset-0 after:rounded-xl"
                  >
                    {heading}
                  </a>
                </h3>

                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section class="mt-20 sm:mt-28">
          <div class="flex items-center gap-2.5">
            <Icon name="bolt" class="size-5 text-primary" />
            <h2 class="font-semibold">Where to go next</h2>
          </div>

          <div class="mt-5 grid gap-4 sm:grid-cols-3">
            {NEXT_STEPS.map(({ command, note }) => (
              <div class="space-y-2">
                <Command>{command}</Command>
                <p class="px-1 text-sm text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }
}
