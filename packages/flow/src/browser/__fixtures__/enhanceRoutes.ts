/**
 * A plain server-rendered page — no Flow component anywhere on it.
 *
 * That absence is the fixture. `<form data-enhance>` exists precisely for the
 * pages Flow does not otherwise touch, so a fixture built out of `Router.flow` and
 * a `Component` would be testing a different feature: those pages already have the
 * runtime, a socket and a morph. These routes are ordinary `Router.get` /
 * `Router.post` handlers returning strings, which is what an app's non-Flow pages
 * are, and they pull in `/__flow/enhance.js` by hand the way a layout would.
 */
import { Router, type HttpContext } from "@zerotal/core";
import { flowEnhanceTag } from "../../enhanceTag.ts";

/** Rendered into every response so a test can tell one render from the next. */
let renderCount = 0;

/** Reset between tests so counts are about the test that reads them. */
export function _resetEnhanceFixtures(): void {
  renderCount = 0;
}

function page(body: string): string {
  renderCount++;
  return `<!doctype html>
<html>
  <head>
    <title>Plain page</title>
    ${flowEnhanceTag()}
  </head>
  <body>
    <p id="renders">${renderCount}</p>
    ${body}
  </body>
</html>`;
}

/** The form, with whatever message the last submission produced. */
function subscribeForm(message: string, value: string): string {
  return `<form id="subscribe" method="post" action="/plain/subscribe" data-enhance>
      <p id="message">${message}</p>
      <input id="email" name="email" value="${value}" />
      <button id="submit" type="submit">Subscribe</button>
    </form>`;
}

/** Register the plain routes on the running app. */
export function registerEnhanceFixtures(): void {
  Router.get(
    "/plain/form",
    class PlainFormPage {
      handle(http: HttpContext): void {
        http.response = new Response(page(subscribeForm("start", "")), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    },
    "handle",
  );

  Router.post(
    "/plain/subscribe",
    class PlainFormSubmit {
      async handle(http: HttpContext): Promise<void> {
        const form = await http.request.formData();
        const email = String(form.get("email") ?? "");
        // A validation failure re-renders the form with the error in it — the case
        // the enhancement exists to make painless, because the response carries the
        // markup and patching it in is the natural answer.
        const message = email.includes("@") ? `subscribed ${email}` : "that is not an email";
        http.response = new Response(page(subscribeForm(message, email)), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    },
    "handle",
  );

  // A form whose success path redirects, so the swap-and-pushState branch is
  // exercised against a real 302 rather than a mocked one.
  Router.get(
    "/plain/redirecting",
    class RedirectingFormPage {
      handle(http: HttpContext): void {
        http.response = new Response(
          page(`<form id="go" method="post" action="/plain/go" data-enhance>
      <button id="submit" type="submit">Go</button>
    </form>`),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
    },
    "handle",
  );

  Router.post(
    "/plain/go",
    class RedirectingFormSubmit {
      handle(http: HttpContext): void {
        http.response = new Response(null, {
          status: 303,
          headers: { Location: "/plain/landed" },
        });
      }
    },
    "handle",
  );

  Router.get(
    "/plain/landed",
    class LandedPage {
      handle(http: HttpContext): void {
        http.response = new Response(page(`<p id="landed">landed</p>`), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    },
    "handle",
  );

  // The same form without `data-enhance`, to prove the enhancement is what changes
  // the behaviour rather than something else on the page.
  Router.get(
    "/plain/unenhanced",
    class UnenhancedFormPage {
      handle(http: HttpContext): void {
        http.response = new Response(
          page(`<form id="subscribe" method="post" action="/plain/subscribe">
      <input id="email" name="email" value="" />
      <button id="submit" type="submit">Subscribe</button>
    </form>`),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
    },
    "handle",
  );
}
