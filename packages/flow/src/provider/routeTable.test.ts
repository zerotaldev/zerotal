import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Router } from "@zerotal/core";
import { route, resetRoutes } from "@zerotal/core/routes";
import { _routeTablePrelude } from "./FlowProvider.ts";
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
