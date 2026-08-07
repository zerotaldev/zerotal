import { describe, it, expect } from "bun:test";
import { isAllowedOrigin, allowedOriginsFrom } from "./originGuard.ts";

/**
 * Regression guard for cross-site WebSocket hijacking and raw-route CSRF.
 *
 * The WS upgrade previously read `origin: new URL(req.url).origin` — the *server's* own origin,
 * derived from the request URL — and never looked at the browser-supplied `Origin` header. WS
 * handshakes are exempt from the same-origin policy but still carry cookies, so `evil.com`
 * opening `wss://app/__flow/ws` got a fully authenticated socket.
 *
 * `/__flow/http` had the matching hole on the HTTP side: `Router.raw()` stores the handler
 * outside the middleware pipeline, so `CsrfMiddleware` never ran, and a cross-origin `fetch`
 * with `credentials: "include"` and the default `text/plain` content type is a CORS-simple
 * request — no preflight to stop it.
 */

const req = (url: string, origin?: string | null): Request =>
  new Request(url, origin === undefined ? {} : { headers: origin === null ? {} : { origin } });

describe("isAllowedOrigin", () => {
  it("allows a same-origin request", () => {
    expect(isAllowedOrigin(req("https://app.example/__flow/ws", "https://app.example"))).toBe(true);
  });

  it("refuses a cross-origin request", () => {
    expect(isAllowedOrigin(req("https://app.example/__flow/ws", "https://evil.example"))).toBe(
      false,
    );
  });

  it("refuses look-alike origins", () => {
    // Suffix matching would accept all of these, which is why the comparison is exact.
    for (const evil of [
      "https://app.example.evil.com",
      "https://evil-app.example",
      "https://app.example.co",
      "http://app.example", // scheme differs — a different origin
      "https://app.example:8443", // port differs
    ]) {
      expect({ evil, ok: isAllowedOrigin(req("https://app.example/x", evil)) }).toEqual({
        evil,
        ok: false,
      });
    }
  });

  it("allows a request with no Origin header — native and CLI clients", () => {
    // Those clients are not subject to cross-site request forgery, and refusing them would
    // break every non-browser consumer.
    expect(isAllowedOrigin(req("https://app.example/x"))).toBe(true);
    expect(isAllowedOrigin(req("https://app.example/x", ""))).toBe(true);
  });

  it('refuses the literal "null" origin', () => {
    // Sent by sandboxed iframes, data: documents and some redirected cross-origin requests.
    expect(isAllowedOrigin(req("https://app.example/x", "null"))).toBe(false);
  });

  it("honours an explicit allow-list for split frontend/API deployments", () => {
    const allowed = ["https://spa.example"];
    expect(isAllowedOrigin(req("https://api.example/x", "https://spa.example"), allowed)).toBe(
      true,
    );
    expect(isAllowedOrigin(req("https://api.example/x", "https://other.example"), allowed)).toBe(
      false,
    );
  });

  it("does not treat the allow-list as a pattern list", () => {
    const allowed = ["https://spa.example"];
    expect(
      isAllowedOrigin(req("https://api.example/x", "https://spa.example.evil.com"), allowed),
    ).toBe(false);
  });
});

describe("allowedOriginsFrom", () => {
  it("reads a string array from config", () => {
    expect(allowedOriginsFrom({ allowedOrigins: ["https://a", "https://b"] })).toEqual([
      "https://a",
      "https://b",
    ]);
  });

  it("defaults to same-origin-only when unset or malformed", () => {
    for (const config of [undefined, null, {}, { allowedOrigins: "https://a" }]) {
      expect(allowedOriginsFrom(config)).toEqual([]);
    }
  });

  it("drops non-string and empty entries rather than trusting them", () => {
    expect(allowedOriginsFrom({ allowedOrigins: ["https://a", "", 42, null] })).toEqual([
      "https://a",
    ]);
  });
});
