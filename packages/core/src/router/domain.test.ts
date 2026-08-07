import { describe, it, expect, beforeEach } from "bun:test";
import { Router } from "./Router.ts";
import { Container } from "../container/Container.ts";
import { compileDomain, matchDomain } from "./domain.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

describe("compileDomain / matchDomain", () => {
  const d = compileDomain(":tenant.app.com");
  it("extracts a dynamic label, case-insensitively, ignoring port", () => {
    expect(matchDomain(d, "acme.app.com")).toEqual({ tenant: "acme" });
    expect(matchDomain(d, "ACME.app.com:443")).toEqual({ tenant: "acme" });
  });
  it("returns null when the host does not match", () => {
    expect(matchDomain(d, "app.com")).toBeNull(); // no label
    expect(matchDomain(d, "a.b.app.com")).toBeNull(); // one label only
    expect(matchDomain(d, "acme.other.com")).toBeNull();
  });
  it("matches a fully static domain", () => {
    expect(matchDomain(compileDomain("admin.app.com"), "admin.app.com")).toEqual({});
    expect(matchDomain(compileDomain("admin.app.com"), "app.com")).toBeNull();
  });
  it("supports multiple labels", () => {
    const r = compileDomain(":region.:tenant.app.com");
    expect(matchDomain(r, "eu.acme.app.com")).toEqual({ region: "eu", tenant: "acme" });
  });
});

class TenantCtrl {
  handle(http: HttpContext) {
    http.json({ who: "tenant", sub: http.subdomains });
  }
}
class AdminCtrl {
  handle(http: HttpContext) {
    http.json({ who: "admin", sub: http.subdomains });
  }
}
class MainCtrl {
  handle(http: HttpContext) {
    http.json({ who: "main", sub: http.subdomains });
  }
}

const hit = async (path: string, host: string) => {
  const compiled = Router.compile(new Container());
  const handler = (compiled[path] as Record<string, (r: Request) => Promise<Response>>)["GET"]!;
  const res = await handler(new Request(`http://${host}${path}`, { headers: { host } }));
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

describe("Router.group({ domain })", () => {
  beforeEach(() => Router.reset());

  it("dispatches one shared path by host and exposes ctx.subdomains", async () => {
    // Specific domains must be registered before wildcards (first match wins).
    Router.group({ domain: "admin.app.com" }, () => {
      Router.get("/", AdminCtrl, "handle");
    });
    Router.group({ domain: ":tenant.app.com" }, () => {
      Router.get("/", TenantCtrl, "handle");
    });
    Router.get("/", MainCtrl, "handle"); // plain fallback for any other host

    expect((await hit("/", "acme.app.com")).body).toEqual({
      who: "tenant",
      sub: { tenant: "acme" },
    });
    expect((await hit("/", "admin.app.com")).body).toEqual({ who: "admin", sub: {} });
    expect((await hit("/", "app.com")).body).toEqual({ who: "main", sub: {} });
    expect((await hit("/", "somewhere.else.com")).body).toEqual({ who: "main", sub: {} });
  });

  it("404s a domain-only path when no host matches and there is no plain route", async () => {
    Router.group({ domain: ":tenant.app.com" }, () => {
      Router.get("/portal", TenantCtrl, "handle");
    });
    expect((await hit("/portal", "acme.app.com")).body).toEqual({
      who: "tenant",
      sub: { tenant: "acme" },
    });
    expect((await hit("/portal", "evil.com")).status).toBe(404);
  });

  it("combines domain with prefix + middleware in one group", async () => {
    Router.group({ domain: ":tenant.app.com", prefix: "/api" }, () => {
      Router.get("/me", TenantCtrl, "handle");
    });
    expect((await hit("/api/me", "acme.app.com")).body).toEqual({
      who: "tenant",
      sub: { tenant: "acme" },
    });
  });
});
