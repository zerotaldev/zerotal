/**
 * Auto-start entry for the standalone inspector dashboard, bundled on demand and
 * served at `GET /__zerotal/devtools/dashboard.js`.
 *
 * The dashboard is the same panel as the injected one, mounted full-window. It
 * used to be a second implementation living in `panel.html` — a thousand lines
 * of duplicated markup, CSS, and formatters that drifted from the panel it
 * shadowed and never gained the plugin tabs the panel had. Sharing the renderer
 * means a tab added anywhere shows up in both.
 */
import { DevTools } from "./client/index.ts";

DevTools.start({ mode: "standalone" });
