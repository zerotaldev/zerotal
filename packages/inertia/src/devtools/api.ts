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

/** The part of `Bun.serve`'s server a raw route can read the socket address from. */
interface PeerSource {
  requestIP?(request: Request): { address: string } | null;
}

/** The socket address a raw route's request came from, or `null` when there is no server. */
function _peer(request: Request, server: unknown): string | null {
  return (server as PeerSource | undefined)?.requestIP?.(request)?.address ?? null;
}

/**
 * Whether a request that changes something was sent by a page on another site.
 *
 * A web page on another site can send one from the developer's own browser, which
 * passes the gate — it is the developer's machine asking. Browsers always name the
 * sending page's origin. The browser extension that reads this API sends its own
 * extension origin, and a command-line client sends none, so only a web origin
 * that is not this server's is refused.
 */
function _crossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !/^https?:\/\//i.test(origin)) return false;
  try {
    return origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

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
    async (request: Request, server?: unknown): Promise<Response> => {
      if (!(await devtoolsAuthorized(request, _peer(request, server)))) {
        return json({ error: "Forbidden" }, 403);
      }
      const url = new URL(request.url);
      return json(listEntries(parseListQuery(url.searchParams)));
    },
  );

  Router.raw(
    "GET",
    `${DEVTOOLS_API_PREFIX}/entries/:id`,
    async (request: Request, server?: unknown): Promise<Response> => {
      if (!(await devtoolsAuthorized(request, _peer(request, server)))) {
        return json({ error: "Forbidden" }, 403);
      }

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
    async (request: Request, server?: unknown): Promise<Response> => {
      if (!(await devtoolsAuthorized(request, _peer(request, server)))) {
        return json({ error: "Forbidden" }, 403);
      }
      if (_crossSite(request)) return json({ error: "Forbidden origin" }, 403);
      clearEntries();
      return new Response(null, { status: 204 });
    },
  );
}
