import type { FormEvent, ReactNode } from "react";
import { Head, useForm, usePage } from "@inertiajs/react";
import PublicLayout from "../Layouts/PublicLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { Code } from "../Components/Code";
import { TextAreaField, TextField } from "../Components/Field";
import { MailIcon } from "../Components/Icon";
import type { SharedProps } from "../types";

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
    where: "Layouts/PublicLayout.tsx",
    what: (
      <>
        Wraps the page. Assigned via <Code>Page.layout</Code>, it stays mounted across visits — the
        header never re-renders.
      </>
    ),
  },
];

const TREE = [
  {
    path: "app/routes/",
    note: "One file per URL. (guest)/ and (auth)/ group them by who may visit.",
  },
  { path: "bootstrap/", note: "Application creation and the provider list." },
  { path: "config/", note: "Typed config objects, read with config('app.name')." },
  { path: "resources/js/pages/", note: "Inertia page components, one per screen." },
  { path: "resources/js/Layouts/", note: "Persistent shells that survive navigation." },
  { path: "resources/js/Components/", note: "Buttons, cards, fields — the shared vocabulary." },
  { path: "resources/css/app.css", note: "Design tokens. Every colour in the app starts here." },
  { path: "tests/", note: "Runs with the app booted via bun zt test." },
];

function About({ title }: Props) {
  // Repopulate from the input the server flashed back after a failed validate().
  const { old } = usePage<SharedProps>().props;

  const { data, setData, post, processing, errors, reset } = useForm({
    name: typeof old["name"] === "string" ? old["name"] : "",
    email: typeof old["email"] === "string" ? old["email"] : "",
    message: typeof old["message"] === "string" ? old["message"] : "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    // The form is at the foot of a long page: stay there while the server answers.
    post(route("about.store"), { preserveScroll: true, onSuccess: () => reset() });
  }

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

        <section id="contact" className="mt-14 scroll-mt-24">
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Say hello
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Get in touch</h2>
          <p className="mt-3 leading-relaxed text-pretty text-muted-foreground">
            This form is the pattern every other one follows. Submit it empty, or with a malformed
            address, and watch the server send the errors and your input straight back.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <Card className="p-6 sm:p-8 lg:col-span-3">
              <form onSubmit={submit} className="space-y-5" noValidate>
                <TextField
                  label="Name"
                  name="name"
                  value={data.name}
                  error={errors.name}
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  onChange={(event) => setData("name", event.target.value)}
                />

                <TextField
                  label="Email"
                  name="email"
                  type="email"
                  value={data.email}
                  error={errors.email}
                  autoComplete="email"
                  placeholder="ada@example.com"
                  onChange={(event) => setData("email", event.target.value)}
                />

                <TextAreaField
                  label="Message"
                  name="message"
                  value={data.message}
                  error={errors.message}
                  hint="At least 10 characters."
                  placeholder="What's on your mind?"
                  onChange={(event) => setData("message", event.target.value)}
                />

                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={processing}>
                    {processing ? (
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                      />
                    ) : null}
                    {processing ? "Sending…" : "Send message"}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Nothing is stored — see the route.
                  </p>
                </div>
              </form>
            </Card>

            <div className="space-y-6 lg:col-span-2">
              <Card className="p-6">
                <h2 className="font-semibold text-card-foreground">What happens on submit</h2>
                <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">1.</span> The POST reaches{" "}
                    <Code>app/routes/about.ts</Code>.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">2.</span> <Code>validate()</Code>{" "}
                    checks the body and returns typed data.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">3.</span> If it fails, errors and
                    input are flashed and you are redirected back.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">4.</span> If it passes, a success
                    flash becomes the toast in the corner.
                  </li>
                </ol>
              </Card>

              <Card className="p-6">
                <h2 className="font-semibold text-card-foreground">Prefer email?</h2>
                <a
                  href="mailto:hello@example.com"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                >
                  <MailIcon className="size-4" />
                  hello@example.com
                </a>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

(About as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <PublicLayout>{page}</PublicLayout>
);

export default About;
