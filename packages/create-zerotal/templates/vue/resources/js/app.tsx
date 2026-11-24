import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import { defineRoutes, route } from "zerotal/routes";
import { pages } from "./pages.generated.ts";
import { ROUTES } from "../../types/routes.generated.ts";
import type { SharedProps } from "./types.ts";
import "../css/app.css";

// Hand the browser the route table so `route("about")` works in a component the way
// it does in a controller. `defineRoutes` also installs `route()` globally, so pages
// call it without an import. The table is regenerated on every `zt dev`.
defineRoutes(ROUTES);

// The app's name, from config/app.ts by way of the shared `app` prop. Read from the
// first page in `setup()` below, which runs before anything renders a title.
let appName = "";

createInertiaApp({
  // Suffix every `<Head title="…" />` with the app name, so a page only has to
  // name itself. Pages that set no title fall back to the app name alone.
  title: (title) => (title && appName ? `${title} — ${appName}` : title || appName),

  // Map a component name (e.g. "settings/profile") to its lazily-loaded module.
  // `pages` is generated from the configured pages dir by `inertia:build`.
  resolve: async (name): Promise<DefineComponent> => {
    // `pages` is keyed by literal page name (written with `satisfies`, so the
    // server can check `Inertia.render("settings/profile", …)` against it). The name
    // Inertia hands us is a runtime string, so this one lookup widens it.
    const page = (pages as Record<string, () => Promise<{ default: unknown }>>)[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as DefineComponent;
  },

  // The top-of-page loading bar shown during slow visits. `--primary` is read off
  // the document so the bar follows the theme instead of hardcoding a colour.
  progress: {
    color: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    delay: 200,
  },

  setup({ el, App, props, plugin }) {
    appName = (props.initialPage.props as Partial<SharedProps>).app?.name ?? "";

    const app = createApp({ render: () => h(App, props) });

    // A Vue template resolves an unknown identifier against `globalProperties`, not
    // against JS globals — so `defineRoutes()` installing `route()` on `globalThis`
    // is enough for `<script setup>` and not for `<template>`. This is what makes
    // `:href="route('about')"` work in a template. resources/js/route.d.ts types it.
    app.config.globalProperties.route = route;

    app.use(plugin).mount(el as Element);
  },
});
