import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { ButtonLink } from "../Components/Button";
import { Card } from "../Components/Card";
import { Code } from "../Components/Code";
import { ArrowRightIcon } from "../Components/Icons";

interface Props {
  title: string;
}

/** The trip this very page made, from URL to rendered React. */
const LIFECYCLE = [
  {
    where: "app/routes/about.ts",
    what: (
      <>
        The URL <Code>/about</Code> is this file's path. Its exported <Code>GET</Code> function runs
        on the server.
      </>
    ),
  },
  {
    where: 'Inertia.render("about", props)',
    what: (
      <>
        Names the page component and hands it data. On a first load the server returns HTML; on
        every visit after that, just JSON.
      </>
    ),
  },
  {
    where: "resources/js/pages/about.tsx",
    what: (
      <>
        Receives <Code>props</Code> as React props. Each page is bundled into its own chunk and
        fetched the first time it is needed.
      </>
    ),
  },
  {
    where: "Layouts/AppLayout.tsx",
    what: (
      <>
        Wraps the page. Assigned via <Code>Page.layout</Code>, it stays mounted across visits — the
        header never re-renders.
      </>
    ),
  },
];

const TREE = [
  { path: "app/routes/", note: "One file per URL. Exports GET, POST, PUT, DELETE." },
  { path: "bootstrap/", note: "Application creation and the provider list." },
  { path: "config/", note: "Typed config objects, read with config('app.name')." },
  { path: "resources/js/pages/", note: "Inertia page components, one per screen." },
  { path: "resources/js/Layouts/", note: "Persistent shells that survive navigation." },
  { path: "resources/js/Components/", note: "Buttons, cards, fields — the shared vocabulary." },
  { path: "resources/css/app.css", note: "Design tokens. Every colour in the app starts here." },
  { path: "tests/", note: "Runs with the app booted via bun zt test." },
];

function About({ title }: Props) {
  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-3xl">
        <header>
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            The tour
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
            One TypeScript project serves the HTML, owns the data, and renders the React. Here is
            how the page you are reading got here.
          </p>
        </header>

        <section className="mt-14">
          <h2 className="font-semibold">From URL to rendered page</h2>

          <ol className="mt-6 space-y-px">
            {LIFECYCLE.map((step, index) => (
              <li key={step.where} className="flex gap-4">
                {/* The rail: a number, and a line joining it to the next step. */}
                <div className="flex flex-col items-center">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card font-mono text-sm text-primary">
                    {index + 1}
                  </span>
                  {index < LIFECYCLE.length - 1 ? (
                    <span aria-hidden="true" className="w-px flex-1 bg-border" />
                  ) : null}
                </div>

                <div className="pb-8">
                  <p className="font-mono text-sm text-foreground">{step.where}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.what}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="font-semibold">Where things live</h2>

          <Card className="mt-5 divide-y divide-border overflow-hidden">
            {TREE.map(({ path, note }) => (
              <div
                key={path}
                className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <span className="shrink-0 font-mono text-sm text-primary sm:w-56">{path}</span>
                <span className="text-sm text-muted-foreground">{note}</span>
              </div>
            ))}
          </Card>
        </section>

        <section className="mt-14 rounded-xl border border-border bg-accent/40 p-6 sm:p-8">
          <h2 className="font-semibold">See a form do all of it</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The contact page posts to a route, validates on the server, and comes back with either a
            flash message or the errors and your original input — no client-side state to reconcile.
          </p>
          <ButtonLink href={route("contact")} className="mt-5">
            Open the contact form
            <ArrowRightIcon className="size-4" />
          </ButtonLink>
        </section>
      </div>
    </>
  );
}

(About as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default About;
