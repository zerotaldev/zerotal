import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Code } from "../components/Code";
import { TextAreaField, TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { PublicLayout } from "../layouts/PublicLayout";
import { Page, titled } from "../lib/page";

/**
 * GET /contact — a working form, end to end.
 *
 * Worth reading as a pattern rather than as content: the browser posts, the server
 * validates, and a failure comes back as a redirect carrying the errors and what was
 * typed, which `this.error()` and `this.old()` read back. There is no client-side
 * validation to keep in step with the server's rules, and no fetch/loading/error state
 * to hand-roll.
 *
 * The form posts to app/routes/contact.ts.
 */
export class ContactPage extends Page {
  static override title = titled("Get in touch");

  override layout(page: HtmlNode): HtmlNode {
    return <PublicLayout shell={this.shell()}>{page}</PublicLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="mx-auto max-w-4xl">
        <header class="max-w-2xl">
          <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Say hello
          </p>
          <h1 class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Get in touch
          </h1>
          <p class="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
            Submit it empty, or with a malformed address, and watch the server send the errors and
            your input straight back.
          </p>
        </header>

        <div class="mt-12 grid gap-6 lg:grid-cols-5">
          <Card class="p-6 sm:p-8 lg:col-span-3">
            <form method="post" action={route("contact.store")} class="space-y-5" novalidate>
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
                  <Code>app/routes/contact.ts</Code>.
                </li>
                <li>
                  <span class="font-medium text-foreground">2.</span> <Code>validate()</Code> checks
                  the body and returns typed data.
                </li>
                <li>
                  <span class="font-medium text-foreground">3.</span> If it fails, errors and input
                  are flashed and you are redirected back.
                </li>
                <li>
                  <span class="font-medium text-foreground">4.</span> If it passes, a success flash
                  becomes the toast in the corner.
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
      </div>
    );
  }
}
