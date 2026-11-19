/**
 * Auto-start entry for the server-injected devtools client — the `client` bundle
 * (see `clientAssets.ts`). Built into `dist/client.js` when the package is packed,
 * served at `/__zerotal/devtools/assets/client.<hash>.js`, and injected into dev
 * HTML responses by the core dev injector — so apps get the floating panel with no
 * `DevTools.start()` call in their own bundle.
 *
 * Not in the published package; only what is built from it is.
 */
import { DevTools } from "./client/index.ts";

DevTools.start();
