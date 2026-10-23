import { describe, it, expect } from "bun:test";
import { withApp, type Application } from "@zerotal/core";
import { _flowRemoteIp } from "./FlowProvider.ts";

/**
 * The address a Flow connection, or a call over the HTTP fallback, is attributed to feeds the
 * invalid-snapshot limiter and the connection list. The fallback used to use the whole
 * `X-Forwarded-For` header as the address, so a client chose its own bucket by writing it, and
 * with no header every client shared the single bucket "unknown".
 */
const post = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/__flow/http", { method: "POST", headers });

/** What `Bun.serve` hands a route as its second argument. */
const serverSeeing = (address: string) => ({
  requestIP: () => ({ address, family: "IPv4", port: 0 }),
});

function appWithThrottle(throttle: unknown): Application {
  const manager = {
    get: (path: string, fallback?: unknown) => (path === "app.throttle" ? throttle : fallback),
  };
  return { container: { makeSync: () => manager } } as unknown as Application;
}

describe("_flowRemoteIp", () => {
  it("is the socket address, whatever X-Forwarded-For says", () => {
    const req = post({ "x-forwarded-for": "6.6.6.6" });

    expect(_flowRemoteIp(req, serverSeeing("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("is one answer for one client however it varies the header", () => {
    const server = serverSeeing("203.0.113.9");
    const seen = new Set(
      ["1.1.1.1", "2.2.2.2", "a, b, c", ""].map((typed) =>
        _flowRemoteIp(post(typed ? { "x-forwarded-for": typed } : {}), server),
      ),
    );

    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("tells clients apart when the header is absent, instead of calling them all unknown", () => {
    expect(_flowRemoteIp(post(), serverSeeing("203.0.113.9"))).toBe("203.0.113.9");
    expect(_flowRemoteIp(post(), serverSeeing("203.0.113.10"))).toBe("203.0.113.10");
  });

  it("reads the client from the right of the header when the app has a proxy", () => {
    const app = appWithThrottle({ maxAttempts: 60, windowSeconds: 60, trustedProxies: 1 });
    const req = post({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });

    expect(withApp(app, () => _flowRemoteIp(req, serverSeeing("10.0.0.1")))).toBe("203.0.113.9");
  });

  it("does not need a server: no socket and no proxy is unknown, not the header", () => {
    expect(_flowRemoteIp(post({ "x-forwarded-for": "6.6.6.6" }), undefined)).toBe("unknown");
  });
});
