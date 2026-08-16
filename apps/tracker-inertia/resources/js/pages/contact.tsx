import type { FormEvent, ReactNode } from "react";
import { Head, useForm, usePage } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { Code } from "../Components/Code";
import { TextAreaField, TextField } from "../Components/Field";
import { MailIcon } from "../Components/Icons";
import type { SharedProps } from "../types";

interface Props {
  title: string;
}

/**
 * A working form, end to end.
 *
 * Worth reading as a pattern rather than as content: the browser posts, the
 * server validates, and a failure comes back as a redirect carrying `errors`
 * and `old`. There is no client-side validation to keep in step with the
 * server's rules, and no fetch/loading/error state to hand-roll — `useForm`
 * exposes `processing` and reads the error bag off the page props.
 *
 * The matching route is app/routes/contact.ts.
 */
function Contact({ title }: Props) {
  // Repopulate from the input the server flashed back after a failed validate().
  const { old } = usePage<SharedProps>().props;

  const { data, setData, post, processing, errors } = useForm({
    name: typeof old["name"] === "string" ? old["name"] : "",
    email: typeof old["email"] === "string" ? old["email"] : "",
    message: typeof old["message"] === "string" ? old["message"] : "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    post("/contact");
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-4xl">
        <header className="max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Say hello
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
            Submit it empty, or with a malformed address, and watch the server send the errors and
            your input straight back.
          </p>
        </header>

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
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
                <p className="text-sm text-muted-foreground">Nothing is stored — see the route.</p>
              </div>
            </form>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className="p-6">
              <h2 className="font-semibold text-card-foreground">What happens on submit</h2>
              <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">1.</span> The POST reaches{" "}
                  <Code>app/routes/contact.ts</Code>.
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
      </div>
    </>
  );
}

(Contact as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default Contact;
