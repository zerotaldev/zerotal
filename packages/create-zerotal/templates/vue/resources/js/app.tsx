import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import { pages } from "./pages.generated.ts";
import "../css/app.css";

createInertiaApp({
  // Map a component name (e.g. "Users/Index") to its lazily-loaded module.
  // `pages` is generated from the configured pages dir by `inertia:build`.
  resolve: async (name): Promise<DefineComponent> => {
    const page = pages[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as DefineComponent;
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el as Element);
  },
});
