import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { ButtonLink, buttonClass } from "../Components/Button";
import { Card, CardIcon } from "../Components/Card";
import { Code, Command } from "../Components/Code";
import {
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  DatabaseIcon,
  FolderIcon,
  LayersIcon,
  ShieldIcon,
  TerminalIcon,
} from "../Components/Icons";
import { DOCS_URL } from "../lib/site";

interface Props {
  title: string;
  message: string;
}

const docs = (page: string) => `${DOCS_URL}/blob/main/docs/${page}`;

const FEATURES = [
  {
    icon: FolderIcon,
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
    icon: LayersIcon,
    heading: "Pages, not endpoints",
    body: (
      <>
        A route returns <Code>Inertia.render(&quot;home&quot;, props)</Code> and this component
        receives them as React props. No API layer in between to build, version or keep in step.
      </>
    ),
    href: docs("inertia.md"),
  },
  {
    icon: ShieldIcon,
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
    icon: DatabaseIcon,
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
    icon: ClockIcon,
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
    icon: TerminalIcon,
    heading: "A CLI that writes the boilerplate",
    body: (
      <>
        <Code>make:page</Code>, <Code>make:controller</Code>, <Code>route:list</Code>,{" "}
        <Code>repl</Code> — and <Code>make:command</Code> when you need one of your own.
      </>
    ),
    href: docs("commands.md"),
  },
];

const NEXT_STEPS = [
  { command: "bun zt route:list", note: "Every route this app registers, in one table." },
  { command: "bun zt make:page Dashboard", note: "Scaffold a page with its layout wired up." },
  { command: "bun zt test", note: "Run the suite with the application booted." },
];

function Home({ title, message }: Props) {
  return (
    <>
      <Head title="Home" />

      <section className="text-center">
        <span className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          The install worked
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl bg-linear-to-br from-foreground via-foreground to-primary bg-clip-text text-4xl font-bold tracking-tight text-balance text-transparent sm:text-6xl">
          {title}
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
          {message}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/about" size="lg">
            Take the tour
            <ArrowRightIcon className="size-4" />
          </ButtonLink>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary", "lg")}
          >
            Read the docs
          </a>
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          Edit <Code>resources/js/pages/home.tsx</Code> and the page reloads itself.
        </p>
      </section>

      <section className="mt-20 sm:mt-28">
        <h2 className="text-center font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          What you already have
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, heading, body, href }) => (
            <Card key={heading} interactive className="group relative p-5">
              <CardIcon className="transition-colors group-hover:border-primary/40">
                <Icon className="size-5" />
              </CardIcon>

              <h3 className="mt-4 font-semibold text-card-foreground">
                {/* The pseudo-element stretches this link over the whole card, so the
                    entire surface is clickable while its accessible name stays the heading. */}
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="after:absolute after:inset-0 after:rounded-xl"
                >
                  {heading}
                </a>
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-20 sm:mt-28">
        <div className="flex items-center gap-2.5">
          <BoltIcon className="size-5 text-primary" />
          <h2 className="font-semibold">Where to go next</h2>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {NEXT_STEPS.map(({ command, note }) => (
            <div key={command} className="space-y-2">
              <Command>{command}</Command>
              <p className="px-1 text-sm text-muted-foreground">{note}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Inertia persistent layout — preserved across client-side navigations.
(Home as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default Home;
