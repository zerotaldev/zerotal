import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import { pages } from "./pages.generated.ts";
import "../css/app.css";

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
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el as Element);
  },
});
