import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { probeWebSocket, probeTransport } from "./TransportProbe.ts";

/**
 * A stand-in for the deployed app plus whatever sits in front of it. Each path reproduces
 * one of the production failures the probe exists to name.
 */
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const path = new URL(req.url).pathname;
      // The origin guard: the app compares against its own (loopback) origin.
      if (path === "/guarded/ws" && req.headers.get("origin") !== `http://127.0.0.1:${srv.port}`) {
        return new Response("Forbidden origin", { status: 403 });
      }
      // A proxy-level auth gate, which browsers cannot satisfy on a handshake.
      if (path === "/gated/ws") {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="staging"' },
        });
      }
      if (path === "/redirected/ws") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.test/ws" },
        });
      }
      if (path === "/ok/ws" || path === "/guarded/ws") {
        if (srv.upgrade(req, { data: {} })) return undefined;
        return new Response("expected upgrade", { status: 426 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: { message() {} },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

describe("probeWebSocket", () => {
  it("reports 101 when a browser could open the socket", async () => {
    const result = await probeWebSocket(`${base}/ok/ws`, base);
    expect(result.status).toBe(101);
    expect(result.ok).toBe(true);
  });

  it("names the origin guard on a 403, with the config fix", async () => {
    const result = await probeWebSocket(`${base}/guarded/ws`, "https://public.example.com");
    expect(result.status).toBe(403);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("origin guard");
    expect(result.fix).toContain("config/app.ts");
  });

  it("names the proxy auth gate on a 401", async () => {
    const result = await probeWebSocket(`${base}/gated/ws`, base);
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
    // The non-obvious half: browsers never send basic-auth credentials on a handshake.
    expect(result.message).toContain("do");
    expect(result.fix).toContain("Exempt");
  });

  it("explains a 404 as routing rather than a broken app", async () => {
    const result = await probeWebSocket(`${base}/missing/ws`, base);
    expect(result.status).toBe(404);
    expect(result.message).toContain("proxy");
  });

  it("does not follow a redirect — a handshake is not redirected", async () => {
    const result = await probeWebSocket(`${base}/redirected/ws`, base);
    expect(result.status).toBe(302);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("elsewhere.test");
  });

  it("reports an unreachable host instead of throwing", async () => {
    const result = await probeWebSocket("http://127.0.0.1:1/ws", "http://127.0.0.1:1", 2_000);
    expect(result.status).toBeNull();
    expect(result.ok).toBe(false);
  });
});

describe("probeTransport", () => {
  it("probes each registered path against the public base url", async () => {
    const results = await probeTransport(base, ["/ok/ws", "/missing/ws"]);
    expect(results.map((r) => r.status)).toEqual([101, 404]);
  });

  it("skips catch-all registrations, which have no single url", async () => {
    expect(await probeTransport(base, ["*"])).toEqual([]);
  });

  it("sends the base url's origin, not the app's own", async () => {
    // The whole point: the probe impersonates a browser on the public origin.
    const [result] = await probeTransport("https://public.example.com", ["/guarded/ws"]);
    expect(result?.url).toBe("https://public.example.com/guarded/ws");
  });
});
