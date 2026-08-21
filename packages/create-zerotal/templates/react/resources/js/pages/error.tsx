import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { ButtonLink, buttonClass } from "../Components/Button";
import { DOCS_URL } from "../lib/site";

interface Props {
  status: number;
}

/**
 * The page behind every HTTP error the app renders to a browser.
 *
 * `app/exceptions/Handler.ts` picks the status and renders this component, so a
 * missing URL lands inside the app's own shell instead of on a bare framework
 * page. In development the framework's stack-trace page still wins for 500s —
 * this is what production shows.
 */

const COPY: Record<number, { title: string; body: string }> = {
  403: {
    title: "Not allowed",
    body: "You are signed in, but this page is not yours to see.",
  },
  404: {
    title: "No page here",
    body: "The URL does not match any route. Check the address, or head back to the start.",
  },
  419: {
    title: "The page expired",
    body: "Your session timed out before the form was submitted. Reload and try once more.",
  },
  429: {
    title: "Too many requests",
    body: "You have been rate limited. Give it a moment and try again.",
  },
  500: {
    title: "Something broke",
    body: "An error on our side stopped this request. It has been logged.",
  },
  503: {
    title: "Down for maintenance",
    body: "The app is briefly unavailable. It should be back shortly.",
  },
};

const FALLBACK = {
  title: "Something went wrong",
  body: "That request could not be completed.",
};

function ErrorPage({ status }: Props) {
  const { title, body } = COPY[status] ?? FALLBACK;

  return (
    <>
      <Head title={`${status} — ${title}`} />

      <section className="mx-auto max-w-lg py-10 text-center sm:py-20">
        <p
          aria-hidden="true"
          className="bg-linear-to-b from-foreground to-primary bg-clip-text font-mono text-7xl font-bold text-transparent tabular-nums sm:text-8xl"
        >
          {status}
        </p>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>

        <p className="mt-3 leading-relaxed text-pretty text-muted-foreground">{body}</p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href={route("home")}>Back to home</ButtonLink>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary", "md")}
          >
            Read the docs
          </a>
        </div>
      </section>
    </>
  );
}

(ErrorPage as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default ErrorPage;
