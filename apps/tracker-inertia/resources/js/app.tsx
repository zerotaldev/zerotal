import { createInertiaApp, type ResolvedComponent } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { defineRoutes, defineRouteMethods } from "zerotal/routes";
import { ROUTES, METHODS } from "../../types/routes.generated.ts";
import { pages } from "./pages.generated.ts";
import { syncTranslations } from "./lib/i18n.ts";
import { APP_NAME } from "./lib/site.ts";
import "../css/app.css";

/**
 * Teach the browser the route table.
 *
 * The same generated file the server reads, so a URL built here and a URL
 * matched there cannot disagree — and a renamed route is a compile error at
 * every call site rather than a 404 someone finds later.
 */
defineRoutes(ROUTES);
defineRouteMethods(METHODS);

createInertiaApp({
  // Suffix every `<Head title="…" />` with the app name, so a page only has to
  // name itself. Pages that set no title fall back to the app name alone.
  title: (title) => (title ? `${title} — ${APP_NAME}` : APP_NAME),

  // Map a component name (e.g. "Users/Index") to its lazily-loaded module.
  // `pages` is generated from the configured pages dir by `inertia:build`.
  resolve: async (name, incoming): Promise<ResolvedComponent> => {
    // Inertia calls `resolve` with the incoming page *before* swapping the
    // component in, which makes this the one place that can hand the catalog to
    // `__()` early enough for the very first render — layouts included — to be
    // in the right language. See the note in lib/i18n.ts for why the `navigate`
    // event is too late.
    syncTranslations(incoming);

    // `pages` is keyed by literal page name (written with `satisfies`, so the
    // server can check `Inertia.render("Users/Index", …)` against it). The name
    // Inertia hands us is a runtime string, so this one lookup widens it.
    const page = (pages as Record<string, () => Promise<{ default: unknown }>>)[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as ResolvedComponent;
  },

  // The top-of-page loading bar shown during slow visits. `--primary` is read off
  // the document so the bar follows the theme instead of hardcoding a colour.
  progress: {
    color: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    delay: 200,
  },

  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
