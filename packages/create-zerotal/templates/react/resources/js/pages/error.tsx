import type { ComponentType, ReactNode, SVGProps } from "react";
import { Head, usePage } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import PublicLayout from "../Layouts/PublicLayout";
import { Button, ButtonLink } from "../Components/Button";
import { AlertIcon, ClockIcon, LockIcon, SearchIcon } from "../Components/Icon";
import type { SharedProps } from "../types";

interface Props {
  status: number;
}

/**
 * The page behind every HTTP error the app renders to a browser.
 *
 * `app/exceptions/Handler.ts` picks the status and renders this component, so a
 * missing URL lands inside the app's own shell instead of on a bare framework
 * page — the sidebar for someone signed in, the public header for everyone else.
 * In development the framework's stack-trace page still wins for 500s; this is what
 * production shows.
 */

const COPY: Record<
  number,
  { title: string; body: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  403: {
    title: "You don't have access to this",
    body: "This page exists, but it belongs to someone else. If you think that is wrong, ask whoever shared the link.",
    icon: LockIcon,
  },
  404: {
    title: "Page not found",
    body: "Nothing lives at this address. It may have moved, or the link may have a typo in it.",
    icon: SearchIcon,
  },
  419: {
    title: "This page expired",
    body: "The form sat open long enough for its security token to run out. Reload the page and send it again.",
    icon: ClockIcon,
  },
  429: {
    title: "Slow down a little",
    body: "That was a lot of requests in a short time. Wait a moment, then try again.",
    icon: ClockIcon,
  },
  500: {
    title: "Something went wrong on our side",
    body: "The error has been logged. Try again in a moment — if it keeps happening, let us know.",
    icon: AlertIcon,
  },
  503: {
    title: "Down for maintenance",
    body: "We are making some changes. The app will be back shortly.",
    icon: ClockIcon,
  },
};

const FALLBACK = COPY[500]!;

function ErrorPage({ status }: Props) {
  const { auth } = usePage<SharedProps>().props;
  const { title, body, icon: Icon } = COPY[status] ?? FALLBACK;

  return (
    <>
      <Head title={title} />

      <section className="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-16">
        <div className="grid size-14 place-items-center rounded-2xl border border-border bg-accent text-accent-foreground">
          <Icon className="size-7" />
        </div>

        <p className="mt-6 font-mono text-sm font-semibold tracking-widest text-primary">
          ERROR {status}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
        <p className="mt-3 leading-relaxed text-pretty text-muted-foreground">{body}</p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {status === 419 ? (
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
          ) : (
            <ButtonLink href={auth.user ? route("dashboard") : route("home")}>
              {auth.user ? "Go to the dashboard" : "Back to home"}
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={() => window.history.back()}>
            Go back
          </Button>
        </div>
      </section>
    </>
  );
}

/** The shell the visitor was already in: the sidebar once signed in, the public header before. */
function ErrorLayout({ children }: { children: ReactNode }) {
  const { auth } = usePage<SharedProps>().props;
  return auth.user ? <AppLayout>{children}</AppLayout> : <PublicLayout>{children}</PublicLayout>;
}

ErrorPage.layout = (page: ReactNode) => <ErrorLayout>{page}</ErrorLayout>;

export default ErrorPage;
