/**
 * Install the route table into the Flow client runtime.
 *
 * Inertia apps hand `route()` their table by static import, because they own
 * their bundle entry. Flow apps don't: the runtime is built by the framework from
 * `client/index.ts`, and ships prebuilt, so it cannot import a file that lives in
 * the application. The table is handed over as a script of its own instead —
 * `/__flow/assets/routes.<hash>.js`, which sets `window.__zerotalRoutes = {...}`
 * — and this reads it back.
 *
 * A separate script rather than part of the runtime, so the runtime is the same
 * bytes for every app and can be cached for good. The page links the table
 * before the runtime, both `defer`, so it is in place by the time this runs. The
 * table is serialised when a page renders, long after boot, so it includes routes
 * that providers registered after Flow. (`/__flow/runtime.js`, the old unhashed
 * URL, still prepends the table to the runtime it returns.)
 */
import { defineRoutes } from "@zerotal/core/routes";

// Declared rather than cast at the call site: `window` genuinely carries this
// property in a Flow page, and saying so once is what makes reading it type-safe
// everywhere instead of an assertion each time.
declare global {
  interface Window {
    /** The route table, set by the `routes` script the page loads before the runtime. */
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
