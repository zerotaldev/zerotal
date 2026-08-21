import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import { defineRoutes, route } from "zerotal/routes";
import { pages } from "./pages.generated.ts";
import { ROUTES } from "../../types/routes.generated.ts";
import "../css/app.css";

// Hand the browser the route table so `route("about")` works in a component the way
// it does in a controller. `defineRoutes` also installs `route()` globally, so pages
// call it without an import. The table is regenerated on every `zt dev`.
defineRoutes(ROUTES);

createInertiaApp({
  // Map a component name (e.g. "Users/Index") to its lazily-loaded module.
  // `pages` is generated from the configured pages dir by `inertia:build`.
  resolve: async (name): Promise<DefineComponent> => {
    // `pages` is keyed by literal page name (written with `satisfies`, so the
    // server can check `Inertia.render("Users/Index", …)` against it). The name
    // Inertia hands us is a runtime string, so this one lookup widens it.
    const page = (pages as Record<string, () => Promise<{ default: unknown }>>)[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as DefineComponent;
  },
  setup({ el, App, props, plugin }) {
    const app = createApp({ render: () => h(App, props) });

    // A Vue template resolves an unknown identifier against `globalProperties`, not
    // against JS globals — so `defineRoutes()` installing `route()` on `globalThis`
    // is enough for `<script setup>` and not for `<template>`. This is what makes
    // `:href="route('about')"` work in a template.
    app.config.globalProperties.route = route;

    app.use(plugin).mount(el as Element);
  },
});
