/**
 * The read API the extension polls: two endpoints, both JSON, both gated.
 *
 * Registered as raw routes — no middleware pipeline. These are read by a browser
 * extension rather than by the application, so the session, CSRF, and Inertia
 * middleware have nothing to contribute, and running `InertiaDevtoolsMiddleware`
 * over them would record the act of reading the recordings.
 */
import { Router } from "@zerotal/core";
import { devtoolsAuthorized } from "./enabled.ts";
import { getEntry, listEntries, parseListQuery, clearEntries } from "./store.ts";
import { DEVTOOLS_API_PREFIX } from "./types.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The timeline changes every request; a cached copy is always the wrong one.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Register `GET /_inertia/devtools/entries` and `.../entries/:id`.
 *
 * Called by `InertiaProvider` only when the recorder is enabled, so a production
 * process that records nothing also serves nothing — the endpoints do not exist
 * to be probed.
 */
export function registerDevtoolsApi(): void {
  Router.raw(
    "GET",
    `${DEVTOOLS_API_PREFIX}/entries`,
    async (request: Request): Promise<Response> => {
      if (!(await devtoolsAuthorized(request))) return json({ error: "Forbidden" }, 403);
      const url = new URL(request.url);
      return json(listEntries(parseListQuery(url.searchParams)));
    },
  );

  Router.raw(
    "GET",
    `${DEVTOOLS_API_PREFIX}/entries/:id`,
    async (request: Request): Promise<Response> => {
      if (!(await devtoolsAuthorized(request))) return json({ error: "Forbidden" }, 403);

      // Read the id from the URL rather than from route params: this is a raw
      // route, so nothing has parsed the pattern for us.
      const id = new URL(request.url).pathname.slice(`${DEVTOOLS_API_PREFIX}/entries/`.length);
      const entry = getEntry(decodeURIComponent(id));
      return entry ? json(entry) : json({ error: "Not found" }, 404);
    },
  );

  // Not in the protocol, but the panel's "clear" action needs somewhere to go,
  // and a recorder you cannot reset is one you restart the server to clear.
  Router.raw(
    "DELETE",
    `${DEVTOOLS_API_PREFIX}/entries`,
    async (request: Request): Promise<Response> => {
      if (!(await devtoolsAuthorized(request))) return json({ error: "Forbidden" }, 403);
      clearEntries();
      return new Response(null, { status: 204 });
    },
  );
}
