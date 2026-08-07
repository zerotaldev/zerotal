/**
 * Router behaviours whose absence is silent.
 *
 * Each of these failed in a way that produced no error and no log — a route answering on
 * the wrong host, a probe getting 404, a middleware file that was simply never read. That
 * is what makes them worth a test rather than a fix alone.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Router } from "./Router.ts";
import { Container } from "../container/Container.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { NextFn } from "../pipeline/types.ts";

class AdminController {
  async handle(http: HttpContext): Promise<void> {
    http.response = new Response("admin");
  }
}
class PublicController {
  async handle(http: HttpContext): Promise<void> {
    http.response = new Response("public");
  }
}
class HomeController {
  async handle(http: HttpContext): Promise<void> {
    http.response = new Response("home", { headers: { "X-Marker": "yes" } });
  }
}

/** Records whether it ran, so "was this route guarded?" is directly observable. */
let guardRan = false;
class GuardMiddleware {
  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    guardRan = true;
    return next();
  }
}

function compile() {
  return Router.compile(new Container(), []);
}

beforeEach(() => {
  Router.reset();
  guardRan = false;
});

describe("domain groups do not collapse onto one another", () => {
  it("keeps resource() routes registered per host", () => {
    Router.group({ domain: "admin.example.com", middleware: [GuardMiddleware as never] }, () => {
      Router.resource("posts", AdminController as never);
    });
    Router.group({ domain: "example.com" }, () => {
      Router.resource("posts", PublicController as never);
    });

    const paths = [...Router.routes.values()].filter(
      (r) => r.path === "/posts" && r.method === "GET",
    );
    // Two entries, each carrying its own host — one key, and the later group would have
    // erased the admin group's routes *and* its auth middleware.
    expect(paths).toHaveLength(2);
    expect(paths.map((r) => r.domain).sort()).toEqual(["admin.example.com", "example.com"]);
  });

  it("keeps view() routes registered per host", () => {
    Router.group({ domain: "a.example.com" }, () => {
      Router.view("/", () => "A" as never);
    });
    Router.group({ domain: "b.example.com" }, () => {
      Router.view("/", () => "B" as never);
    });

    const roots = [...Router.routes.values()].filter((r) => r.path === "/");
    expect(roots).toHaveLength(2);
    expect(roots.map((r) => r.domain).sort()).toEqual(["a.example.com", "b.example.com"]);
  });

  it("narrowing a resource with only() still respects the group's host", () => {
    Router.group({ domain: "admin.example.com" }, () => {
      Router.resource("posts", AdminController as never).only(["index"]);
    });

    const remaining = [...Router.routes.values()].filter((r) => r.path.startsWith("/posts"));
    // only() re-registers after the group has closed, so the domain has to be captured.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.domain).toBe("admin.example.com");
  });
});

describe("HEAD", () => {
  it("answers on every registered GET route", async () => {
    Router.get("/", HomeController as never, "handle");
    const compiled = compile();

    const entry = compiled["/"] as Record<string, (req: Request) => Promise<Response>>;
    expect(entry["HEAD"]).toBeDefined();

    const res = await entry["HEAD"]!(new Request("http://x/", { method: "HEAD" }));
    expect(res.status).toBe(200);
    // Same headers as GET, no body — that is what a load-balancer probe reads.
    expect(res.headers.get("X-Marker")).toBe("yes");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(await res.text()).toBe("");
  });

  it("is not invented for a path that only has non-GET methods", () => {
    Router.post("/submit", HomeController as never, "handle");
    const compiled = compile();
    const entry = compiled["/submit"] as Record<string, unknown>;
    expect(entry["HEAD"]).toBeUndefined();
  });
});
