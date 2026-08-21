import { createInertiaApp, type ResolvedComponent } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { defineRoutes } from "zerotal/routes";
import { pages } from "./pages.generated.ts";
import { ROUTES } from "../../types/routes.generated.ts";
import "../css/app.css";

// Hand the browser the route table so `route("about")` works in a component the way
// it does in a controller. `defineRoutes` also installs `route()` globally, so pages
// call it without an import. The table is regenerated on every `zt dev`.
defineRoutes(ROUTES);

createInertiaApp({
  // Suffix every `<Head title="…" />` with the app name, so a page only has to
  // name itself. Pages that set no title fall back to the app name alone.
  title: (title) => (title ? `${title} — {{name}}` : "{{name}}"),

  // Map a component name (e.g. "Users/Index") to its lazily-loaded module.
  // `pages` is generated from the configured pages dir by `inertia:build`.
  resolve: async (name): Promise<ResolvedComponent> => {
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
