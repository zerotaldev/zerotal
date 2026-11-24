import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Code } from "../components/Code";
import { TextAreaField, TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { PublicLayout } from "../layouts/PublicLayout";
import { Page, titled } from "../lib/page";

/** The trip this very page made, from URL to rendered HTML. */
const LIFECYCLE: { where: string; what: HtmlNode }[] = [
  {
    where: "routes/web.ts",
    what: (
      <>
        <Code>Router.flow("/about", AboutPage)</Code> puts this page at <Code>/about</Code> and
        names the route <Code>about</Code>, so links write <Code>route("about")</Code>.
      </>
    ),
  },
  {
    where: "app/flow/pages/about.tsx",
    what: (
      <>
        A <Code>Component</Code> class. Its <Code>render()</Code> runs on the server, and the
        browser gets finished HTML — there is no page component to download first.
      </>
    ),
  },
  {
    where: "layout(page)",
    what: (
      <>
        Wraps the page in <Code>PublicLayout</Code>: the header, the footer, and the toasts. A
        layout is a function that returns markup, the same as any other component.
      </>
    ),
  },
  {
    where: "app/routes/about.ts",
    what: (
      <>
        Where this page's form goes. The file's path is the URL, and its exported <Code>POST</Code>{" "}
        runs on the server, validates, and redirects back to the page.
      </>
    ),
  },
];

const TREE = [
  { path: "routes/web.ts", note: "Every page, at its URL and route name." },
  {
    path: "app/routes/",
    note: "What forms send. One file per URL; (guest)/ and (auth)/ group them by who may visit.",
  },
  { path: "bootstrap/", note: "Application creation and the provider list." },
  { path: "config/", note: "Typed config objects, read with config('app.name')." },
  { path: "app/flow/pages/", note: "Flow page components, one per screen." },
  { path: "app/flow/layouts/", note: "The shells a page renders inside." },
  { path: "app/flow/components/", note: "Buttons, cards, fields — the shared vocabulary." },
  { path: "resources/css/app.css", note: "Design tokens. Every colour in the app starts here." },
  { path: "tests/", note: "Runs with the app booted via bun zt test." },
];

/**
 * GET /about — the tour, and a contact form at the end.
 *
 * The form is worth reading as a pattern rather than as content: the browser posts, the
 * server validates, and a failure comes back as a redirect carrying the errors and what
 * was typed, which `this.error()` and `this.old()` read back. There is no client-side
 * validation to keep in step with the server's rules.
 *
 * It posts to app/routes/about.ts. Its action ends in `#contact`, and the browser keeps
 * that fragment through the redirect, so the page comes back scrolled to the form.
 */
export class AboutPage extends Page {
  static override title = titled("How this app fits together");

  override layout(page: HtmlNode): HtmlNode {
    return <PublicLayout shell={this.shell()}>{page}</PublicLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="mx-auto max-w-3xl">
        <header>
          <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">The tour</p>
          <h1 class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            How this app fits together
          </h1>
          <p class="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
            One TypeScript project serves the HTML, owns the data, and renders every page on the
            server. Here is how the page you are reading got here.
          </p>
        </header>

        <section class="mt-14">
          <h2 class="font-semibold">From URL to rendered page</h2>

          <ol class="mt-6 space-y-px">
            {LIFECYCLE.map((step, index) => (
              <li class="flex gap-4">
                {/* The rail: a number, and a line joining it to the next step. */}
                <div class="flex flex-col items-center">
                  <span class="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card font-mono text-sm text-primary">
                    {index + 1}
                  </span>
                  {index < LIFECYCLE.length - 1 ? (
                    <span aria-hidden="true" class="w-px flex-1 bg-border" />
                  ) : null}
                </div>

                <div class="pb-8">
                  <p class="font-mono text-sm text-foreground">{step.where}</p>
                  <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.what}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section class="mt-6">
          <h2 class="font-semibold">Where things live</h2>

          <Card class="mt-5 divide-y divide-border overflow-hidden">
            {TREE.map(({ path, note }) => (
              <div class="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6">
                <span class="shrink-0 font-mono text-sm text-primary sm:w-56">{path}</span>
                <span class="text-sm text-muted-foreground">{note}</span>
              </div>
            ))}
          </Card>
        </section>

        <section id="contact" class="mt-14 scroll-mt-24">
          <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Say hello
          </p>
          <h2 class="mt-3 text-2xl font-bold tracking-tight">Get in touch</h2>
          <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">
            This form is the pattern every other one follows. Submit it empty, or with a malformed
            address, and watch the server send the errors and your input straight back.
          </p>

          <div class="mt-6 grid gap-6 lg:grid-cols-5">
            <Card class="p-6 sm:p-8 lg:col-span-3">
              <form
                method="post"
                action={`${route("about.store")}#contact`}
                class="space-y-5"
                novalidate
              >
                <TextField
                  label="Name"
                  name="name"
                  value={this.old("name")}
                  error={this.error("name")}
                  autocomplete="name"
                  placeholder="Ada Lovelace"
                />

                <TextField
                  label="Email"
                  name="email"
                  type="email"
                  value={this.old("email")}
                  error={this.error("email")}
                  autocomplete="email"
                  placeholder="ada@example.com"
                />

                <TextAreaField
                  label="Message"
                  name="message"
                  value={this.old("message")}
                  error={this.error("message")}
                  hint="At least 10 characters."
                  placeholder="What's on your mind?"
                />

                <div class="flex items-center gap-3 pt-1">
                  <Button type="submit" data-loading-text="Sending…">
                    Send message
                  </Button>
                  <p class="text-sm text-muted-foreground">Nothing is stored — see the route.</p>
                </div>
              </form>
            </Card>

            <div class="space-y-6 lg:col-span-2">
              <Card class="p-6">
                <h2 class="font-semibold text-card-foreground">What happens on submit</h2>
                <ol class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <li>
                    <span class="font-medium text-foreground">1.</span> The POST reaches{" "}
                    <Code>app/routes/about.ts</Code>.
                  </li>
                  <li>
                    <span class="font-medium text-foreground">2.</span> <Code>validate()</Code>{" "}
                    checks the body and returns typed data.
                  </li>
                  <li>
                    <span class="font-medium text-foreground">3.</span> If it fails, errors and
                    input are flashed and you are redirected back.
                  </li>
                  <li>
                    <span class="font-medium text-foreground">4.</span> If it passes, a success
                    flash becomes the toast in the corner.
                  </li>
                </ol>
              </Card>

              <Card class="p-6">
                <h2 class="font-semibold text-card-foreground">Prefer email?</h2>
                <a
                  href="mailto:hello@example.com"
                  class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                >
                  <Icon name="mail" class="size-4" />
                  hello@example.com
                </a>
              </Card>
            </div>
          </div>
        </section>
      </div>
    );
  }
}
