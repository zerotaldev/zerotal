import { describe, it, expect, afterEach } from "bun:test";
import { _bodyLimitResponse, _capRequestBodies, type BodyLimitedRoutes } from "./bodyLimit.ts";

/**
 * Bun has one body ceiling for the whole server. A route that takes more than the rest of the
 * app (an inbound-mail webhook with an attachment) meant raising it for every route, so a
 * webhook that fits in 25 MiB made every login form accept 25 MiB.
 *
 * With a per-route limit the server is told the largest, and the framework holds each other
 * route to its own. These run a real server, because the behaviour under test is what Bun does
 * with the body when a handler refuses it without reading.
 */
// A Request built in memory carries no Content-Length; the transport adds it. Set it, as a
// server would have, so the unit tests read what a real request carries.
const post = (body: string | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", {
    method: "POST",
    body,
    headers: body === null ? headers : { "Content-Length": String(body.length), ...headers },
  });

describe("_bodyLimitResponse", () => {
  it("lets a body at the limit through, and answers 413 for one byte over", async () => {
    expect(_bodyLimitResponse(post("a".repeat(100)), 100)).toBeUndefined();

    const refused = _bodyLimitResponse(post("a".repeat(101)), 100);
    expect(refused?.status).toBe(413);
    expect(await refused?.text()).toContain("100 bytes");
  });

  it("lets a request with no body through, whatever the limit", () => {
    expect(_bodyLimitResponse(new Request("http://localhost/x"), 0)).toBeUndefined();
    expect(_bodyLimitResponse(post(null), 0)).toBeUndefined();
  });

  it("answers 411 for a body sent in chunks, which cannot be measured without reading it", async () => {
    const refused = _bodyLimitResponse(post(null, { "Transfer-Encoding": "chunked" }), 1000);

    expect(refused?.status).toBe(411);
    expect(await refused?.text()).toContain("Content-Length required");
  });

  it("reads Content-Length, not the body, so it never consumes what the handler needs", async () => {
    const req = post("hello");

    _bodyLimitResponse(req, 100);

    expect(req.bodyUsed).toBe(false);
    expect(await req.text()).toBe("hello");
  });
});

describe("_capRequestBodies", () => {
  const ok = () => new Response("ok");

  it("leaves every route alone when nothing raised the ceiling or lowered a limit", () => {
    const routes: BodyLimitedRoutes = { "/a": { POST: ok }, "/b": { PUT: ok } };

    const capped = _capRequestBodies(routes, new Map(), 1000, 1000);

    expect((capped["/a"] as Record<string, unknown>)["POST"]).toBe(ok);
    expect((capped["/b"] as Record<string, unknown>)["PUT"]).toBe(ok);
  });

  it("passes a static Response route through untouched", () => {
    const file = new Response("file");

    expect(_capRequestBodies({ "/logo.svg": file }, new Map(), 10, 100)["/logo.svg"]).toBe(file);
  });

  it("does not wrap the route that owns the ceiling, since Bun enforces it", () => {
    const routes: BodyLimitedRoutes = { "/hook": { POST: ok }, "/other": { POST: ok } };

    const capped = _capRequestBodies(routes, new Map([["POST /hook", 5000]]), 1000, 5000);

    expect((capped["/hook"] as Record<string, unknown>)["POST"]).toBe(ok);
    expect((capped["/other"] as Record<string, unknown>)["POST"]).not.toBe(ok);
  });
});

describe("a server with one route that takes more than the rest", () => {
  const DEFAULT = 1000;
  const HOOK = 5000;
  const LOGIN = 100;

  let servers: Array<{ stop(force?: boolean): void }> = [];
  afterEach(() => {
    for (const server of servers) server.stop(true);
    servers = [];
  });

  /** A route that reports how many bytes it was given; `ran` counts handler entries. */
  function serve() {
    const ran = { count: 0 };
    const count = async (req: Request) => {
      ran.count++;
      return new Response(String((await req.arrayBuffer()).byteLength));
    };
    const routes: BodyLimitedRoutes = {
      "/hook": { POST: count },
      "/api": { POST: count, GET: () => new Response("read") },
      "/login": { POST: count },
    };
    const limits = new Map([
      ["POST /hook", HOOK],
      ["POST /login", LOGIN],
    ]);
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: HOOK,
      routes: _capRequestBodies(routes, limits, DEFAULT, HOOK),
      fetch: () => new Response("fallback", { status: 404 }),
    });
    servers.push(server);
    const url = `http://localhost:${server.port}`;
    return {
      ran,
      send: (path: string, bytes: number) =>
        fetch(url + path, { method: "POST", body: "a".repeat(bytes) }),
      sendChunked: (path: string, bytes: number) =>
        fetch(url + path, {
          method: "POST",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("a".repeat(bytes)));
              controller.close();
            },
          }),
          duplex: "half",
        } as RequestInit),
      get: (path: string) => fetch(url + path),
    };
  }

  it("accepts the large body on the route that declared it", async () => {
    const res = await serve().send("/hook", 4000);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("4000");
  });

  it("still refuses what is over the ceiling itself, on that route", async () => {
    expect((await serve().send("/hook", 6000)).status).toBe(413);
  });

  it("holds every other route to the app limit even though the server accepts more", async () => {
    const { send, ran } = serve();

    expect((await send("/api", 900)).status).toBe(200);
    const refused = await send("/api", 2000);

    expect(refused.status).toBe(413);
    expect(await refused.text()).toContain("1000 bytes");
    expect(ran.count).toBe(1); // the refused request never reached the handler
  });

  it("holds a route to a limit lower than the app limit", async () => {
    const { send } = serve();

    expect((await send("/login", 90)).status).toBe(200);
    expect((await send("/login", 150)).status).toBe(413);
  });

  it("answers 411 for a body in chunks on a route below the ceiling, and allows it on the ceiling route", async () => {
    // Two servers, so the second request cannot share a connection with the refused one: Bun 1.3
    // answers the request after a refused chunked body with 400 once.
    expect((await serve().sendChunked("/api", 10)).status).toBe(411);
    expect((await serve().sendChunked("/hook", 10)).status).toBe(200);
  });

  it("does not touch a request that has no body", async () => {
    const res = await serve().get("/api");

    expect(await res.text()).toBe("read");
  });

  it("keeps serving the connection after refusing a large body unread", async () => {
    const { send } = serve();

    expect((await send("/api", 3000)).status).toBe(413);
    expect((await send("/api", 10)).status).toBe(200);
  });
});
