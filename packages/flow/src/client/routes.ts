/**
 * Install the route table into the Flow client runtime.
 *
 * Inertia apps hand `route()` their table by static import, because they own
 * their bundle entry. Flow apps don't: `/__flow/runtime.js` is built by the
 * framework from `client/index.ts`, so it cannot import a file that lives in
 * the application. The table is handed over at serve time instead — the runtime
 * handler prepends `window.__zerotalRoutes = {...}` to the bundle it returns
 * (see `FlowProvider`), and this reads it back.
 *
 * Prepending rather than embedding at build time is deliberate: the bundle is
 * built in `onBooting()`, when providers registered after Flow have not added
 * their routes yet. The handler runs per request, long after boot, so the table
 * it serialises is the complete one. The bundle is already `no-store`, so there
 * is no cache to invalidate.
 */
import { defineRoutes } from "@zerotal/core/routes";

// Declared rather than cast at the call site: `window` genuinely carries this
// property in a Flow page, and saying so once is what makes reading it type-safe
// everywhere instead of an assertion each time.
declare global {
  interface Window {
    /** The route table the runtime handler prepends to the bundle. */
    __zerotalRoutes?: Readonly<Record<string, string>>;
  }
}

/**
 * Read `window.__zerotalRoutes` and install it, so `$route(...)` in an Alpine
 * expression resolves the same names the server rendered with.
 *
 * Installs an empty table when the global is absent — `route()` then throws
 * "Named route not found" for any name, which is the truthful error. Leaving it
 * uninstalled would instead report a missing `defineRoutes()` call and send the
 * reader looking for app wiring that Flow does not have.
 */
export function installClientRoutes(): void {
  defineRoutes(window.__zerotalRoutes ?? {});
}
