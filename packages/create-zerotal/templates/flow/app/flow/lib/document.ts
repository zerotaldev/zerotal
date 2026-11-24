import { asset } from "zerotal/assets";

/**
 * What every page puts in `<head>`, besides its title: the icon, the stylesheet, the
 * browser script, and the line that picks light or dark before the first paint.
 *
 * Flow writes the rest of the document itself. app/exceptions/Handler.ts writes the
 * error page's document by hand and uses this too, so an error looks like the app.
 *
 * `asset()` runs per request, so a rebuild in development is picked up on the next load.
 */
export function documentHead(): string {
  return `<link rel="icon" href="/zt.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#191922" media="(prefers-color-scheme: dark)" />
  ${THEME_SCRIPT}
  <link rel="stylesheet" href="${asset("/css/app.css")}" />
  <script type="module" src="${asset("/js/app.js")}"></script>`;
}

/**
 * Resolve the theme before the first paint. Without this the page renders in light mode
 * for a frame and then flips, which is very visible on a dark background. Inline and
 * synchronous on purpose — a deferred script is already too late. The storage key matches
 * the one @zerotal/flow-ui uses, so an app and its admin panel stay on the same theme.
 */
const THEME_SCRIPT = `<script>
    (function () {
      try {
        // "light" or "dark" is a choice made in the app; no key means "follow the
        // system", which resources/js/lib/theme.ts also keeps following afterwards.
        var stored = localStorage.getItem("zerotal-theme");
        var dark =
          stored === "light" || stored === "dark"
            ? stored === "dark"
            : window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.classList.toggle("dark", dark);
      } catch (e) {
        /* private mode / storage disabled — fall through to light */
      }
    })();
  </script>`;
