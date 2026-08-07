import { describe, it, expect, beforeEach } from "bun:test";
import { Router, RouterState } from "./Router.ts";
import { withApp } from "../application/currentApp.ts";
import type { Application } from "../application/Application.ts";

class C {
  handle() {}
}

// Router only reads `.routerState` off the current app, so a minimal stand-in suffices.
const appWith = (routerState: RouterState) => ({ routerState }) as unknown as Application;

beforeEach(() => {
  Router.reset();
});

describe("RouterState — instance-owned routing table", () => {
  it("Router.state exposes the live state", () => {
    expect(Router.state).toBeInstanceOf(RouterState);
    Router.get("/a", C as never, "handle");
    expect(Router.state.routes.has("GET /a")).toBe(true);
  });

  it("route registration targets the current application's state", () => {
    const state = new RouterState();
    withApp(appWith(state), () => Router.get("/scoped", C as never, "handle"));
    // The route landed in that app's table, not the standalone fallback.
    expect(state.routes.has("GET /scoped")).toBe(true);
    expect(Router.routes.has("GET /scoped")).toBe(false);
  });

  it("two applications do not share routes", () => {
    const a = new RouterState();
    const b = new RouterState();

    withApp(appWith(a), () => Router.get("/in-a", C as never, "handle"));
    withApp(appWith(b), () => Router.get("/in-b", C as never, "handle"));

    expect(a.routes.has("GET /in-a")).toBe(true);
    expect(a.routes.has("GET /in-b")).toBe(false);
    expect(b.routes.has("GET /in-b")).toBe(true);
    expect(b.routes.has("GET /in-a")).toBe(false);
  });

  it("reset() clears the current state in place (same instance)", () => {
    const before = Router.state;
    Router.get("/x", C as never, "handle");
    Router.reset();
    expect(Router.state).toBe(before);
    expect(Router.routes.size).toBe(0);
  });

  it("named routes, groups and bindings live on the state too", () => {
    const state = new RouterState();
    withApp(appWith(state), () => {
      Router.get("/posts/:post", C as never, "show")
        .name("posts.show")
        .bind("post", ((v: string) => Promise.resolve(v)) as never);
    });
    expect(state.namedRoutes.get("posts.show")).toBe("/posts/:post");
    // The standalone fallback is untouched.
    expect(Router.namedRoutes.has("posts.show")).toBe(false);
  });
});
