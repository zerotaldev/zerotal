import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Router } from "@zerotal/core";
import { route, resetRoutes } from "@zerotal/core/routes";
import { _clientAssetResponse, _routeTablePrelude, _routesAsset } from "../clientAssets.ts";
import { installClientRoutes } from "../client/routes.ts";

describe("Flow route table — serve-time prelude", () => {
  beforeEach(() => Router.reset());

  it("serialises the router's named routes as a window assignment", () => {
    class C {}
    Router.get("/posts/:slug", C, "show").name("posts.show");

    const prelude = _routeTablePrelude();

    expect(prelude).toStartWith("window.__zerotalRoutes=");
    expect(prelude).toEndWith(";\n");
    expect(prelude).toContain('"posts.show":"/posts/:slug"');
  });

  it("emits an empty object when nothing is named", () => {
    expect(_routeTablePrelude()).toBe("window.__zerotalRoutes={};\n");
  });

  it("picks up routes registered after boot", () => {
    // The reason the table is built here and not baked into the bundle: providers
    // that register after Flow would be missing from a boot-time snapshot.
    expect(_routeTablePrelude()).not.toContain("late.route");
    class C {}
    Router.get("/late", C, "handle").name("late.route");
    expect(_routeTablePrelude()).toContain('"late.route":"/late"');
  });
});

describe("Flow route table — its own script", () => {
  beforeEach(() => Router.reset());

  it("is served under a name that changes when, and only when, the routes do", () => {
    class C {}
    Router.get("/posts/:slug", C, "show").name("posts.show");
    const first = _routesAsset();
    expect(first.path).toMatch(/^\/__flow\/assets\/routes\.[0-9a-f]{16}\.js$/);
    expect(new TextDecoder().decode(first.body)).toBe(_routeTablePrelude());

    // Nothing changed: the same script, so a browser's cached copy still applies.
    expect(_routesAsset().path).toBe(first.path);

    // A route added after the first page rendered gives the table a new name, so no
    // browser keeps running the table without it.
    Router.get("/late", C, "handle").name("late.route");
    const second = _routesAsset();
    expect(second.path).not.toBe(first.path);
    expect(new TextDecoder().decode(second.body)).toContain('"late.route":"/late"');
  });

  it("keeps the current table answerable however often the routes change", () => {
    const status = (path: string) =>
      _clientAssetResponse(new Request(`http://localhost${path}`)).status;
    class C {}
    Router.get("/a", C, "handle").name("a");
    const first = _routesAsset();
    for (let i = 0; i < 12; i++) {
      Router.get(`/r${i}`, C, "handle").name(`r${i}`);
      _routesAsset();
    }
    // The oldest are dropped, and a page still asking for one is sent to the current.
    expect(status(first.path)).toBe(302);
    expect(status(_routesAsset().path)).toBe(200);

    // Routes that change back give the first table's name again, and it answers.
    Router.reset();
    Router.get("/a", C, "handle").name("a");
    expect(_routesAsset().path).toBe(first.path);
    expect(status(first.path)).toBe(200);
  });
});

describe("Flow route table — client install", () => {
  const globals = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in globals;
  const original = globals.window;

  beforeEach(() => resetRoutes());
  afterEach(() => {
    if (hadWindow) globals.window = original;
    else delete globals.window;
  });

  it("reads the prelude's global and installs it", () => {
    globals.window = { __zerotalRoutes: { "posts.show": "/posts/:slug" } };
    installClientRoutes();
    expect(route.dynamic("posts.show", { slug: "hello" })).toBe("/posts/hello");
  });

  it("round-trips a real prelude through the global", () => {
    Router.reset();
    class C {}
    Router.get("/docs/*", C, "docs").name("docs.show");

    // Evaluate the served prelude the way a browser would, then install.
    const scope = { window: {} as Record<string, unknown> };
    new Function("window", _routeTablePrelude())(scope.window);
    globals.window = scope.window;
    installClientRoutes();

    expect(route.dynamic("docs.show", { "*": "guides/intro" })).toBe("/docs/guides/intro");
  });

  it("installs an empty table when the global is absent", () => {
    globals.window = {};
    installClientRoutes();
    // "not found" is the truthful error here — Flow apps never call defineRoutes
    // themselves, so the "you forgot to install the table" message would misdirect.
    expect(() => route.dynamic("posts.show")).toThrow("Named route not found");
  });
});
