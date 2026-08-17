import type { FC } from "zerotal/view";
import { asset } from "zerotal/assets";
import { buttonClass } from "./components/Ui.tsx";

const COPY: Record<number, { title: string; body: string }> = {
  403: { title: "Not allowed", body: "You are signed in, but this page is not yours to see." },
  404: { title: "No page here", body: "The URL does not match any route. Check the address, or head back to the start." },
  419: { title: "The page expired", body: "Your session timed out before the form was submitted. Reload and try once more." },
  429: { title: "Too many requests", body: "You have been rate limited. Give it a moment and try again." },
  500: { title: "Something broke", body: "An error on our side stopped this request. It has been logged." },
  503: { title: "Down for maintenance", body: "The app is briefly unavailable. It should be back shortly." },
};

const FALLBACK = { title: "Something went wrong", body: "That request could not be completed." };

/**
 * Not translated, and deliberately.
 *
 * This page renders when something has already gone wrong, and `t()` resolves
 * against a catalog loaded by a provider that a 500 may be the symptom of.
 * Hard-coded English is the version that cannot fail twice.
 */
export const ErrorPage: FC<{ status: number }> = ({ status }) => {
  const { title, body } = COPY[status] ?? FALLBACK;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${status} — ${title}`}</title>
        <link rel="stylesheet" href={asset("app.css")} />
      </head>
      <body class="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
        <section class="mx-auto max-w-lg text-center">
          <p aria-hidden="true" class="font-mono text-6xl font-semibold text-muted-foreground tabular-nums sm:text-7xl">
            {String(status)}
          </p>
          <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
          <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">{body}</p>
          <div class="mt-8">
            <a href="/" class={buttonClass("primary")}>Back to home</a>
          </div>
        </section>
      </body>
    </html>
  );
};
