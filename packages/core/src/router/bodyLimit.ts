/**
 * Request body limits, per route.
 *
 * Bun has one ceiling for the whole server, `maxRequestBodySize`, and answers 413 itself for a
 * body over it, before any of this runs. A route that legitimately takes more than the rest of
 * the app (an inbound-mail webhook with an attachment, an upload endpoint) used to need that one
 * number raised for every route. Instead the server ceiling is raised to the largest limit any
 * route declares, and the framework holds every other route to its own limit here.
 *
 * Bun runs a route handler as soon as the headers arrive and streams the body to it, so refusing
 * a body here costs no memory: the body is not read.
 */
type Handler = (req: Request, server?: unknown) => Response | Promise<Response>;

/** Bun's `routes` table as `Router.compile()` builds it. */
export type BodyLimitedRoutes = Record<string, Record<string, Handler> | Response>;

/**
 * The answer is sent without the body having been read. Bun 1.4 discards the unread bytes; Bun
 * 1.3 does not, and reads those of a chunked body as the start of the next request on the same
 * connection, which is answered 400 once. Cancelling the body and closing the connection were
 * both tried and neither helps there, so the quirk is documented rather than worked around.
 */
function _refuse(status: 411 | 413, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * @internal Backs `Application` and this package's own tests.
 *
 * Answer a request whose body is over `limit` bytes, or return `undefined` to let it through.
 *
 * A body is judged by its `Content-Length`, which Bun holds the connection to: a client cannot
 * send more than it declared. A body with no declared length (chunked) cannot be measured
 * without reading it, and reading it here would consume what the handler needs, so it is
 * refused with 411 rather than let through unmeasured. Browsers, `fetch` with a string, form or
 * blob, and reverse proxies that buffer request bodies all declare a length.
 */
export function _bodyLimitResponse(req: Request, limit: number): Response | undefined {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > limit) {
      return _refuse(413, `Request body too large. This route accepts up to ${limit} bytes.`);
    }
    return undefined;
  }

  if (req.headers.get("transfer-encoding") !== null) {
    return _refuse(
      411,
      `Content-Length required. This route accepts up to ${limit} bytes and a body sent in ` +
        `chunks cannot be measured before it is read.`,
    );
  }
  return undefined;
}

/**
 * @internal Backs `Application` and this package's own tests.
 *
 * Hold each route to its body limit: the one declared with `.maxBodySize()`, else `defaultLimit`.
 * A route whose limit is the server `ceiling` is left alone, since Bun enforces the ceiling
 * itself; so is every route when nothing raised the ceiling and nothing lowered a limit, which
 * is an app that never uses this, and pays nothing.
 *
 * @param overrides - Limits declared per route, keyed `"METHOD /path"` as written at registration.
 * @param defaultLimit - What `app.maxRequestBodySize` says, for a route that declared nothing.
 * @param ceiling - What the server was told to accept: the largest limit in play.
 */
export function _capRequestBodies(
  routes: BodyLimitedRoutes,
  overrides: ReadonlyMap<string, number>,
  defaultLimit: number,
  ceiling: number,
): BodyLimitedRoutes {
  const capped: BodyLimitedRoutes = {};
  for (const [path, entry] of Object.entries(routes)) {
    if (entry instanceof Response) {
      capped[path] = entry;
      continue;
    }

    const wrapped: Record<string, Handler> = { ...entry };
    for (const [method, handler] of Object.entries(entry)) {
      const limit = overrides.get(`${method} ${path}`) ?? defaultLimit;
      if (limit >= ceiling) continue;
      wrapped[method] = (req, server) => _bodyLimitResponse(req, limit) ?? handler(req, server);
    }
    capped[path] = wrapped;
  }
  return capped;
}
