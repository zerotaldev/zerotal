import { describe, it, expect, afterEach } from "bun:test";
import { Application } from "./Application.ts";
import { Router, RouterState } from "../router/Router.ts";

class C {
  handle() {}
}

afterEach(() => {
  Application._resetInstance();
  Router.reset();
});

describe("Application owns its RouterState (Track 4 Phase 2b)", () => {
  it("routes registered after create() land in the app's routing table", () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    expect(app.routerState).toBeInstanceOf(RouterState);
    Router.get("/owned", C as never, "handle");
    expect(Router.routes.has("GET /owned")).toBe(true);
    expect(app.routerState.routes.has("GET /owned")).toBe(true);
  });

  it("_resetInstance() restores the previous routing table", () => {
    Application._resetInstance();
    const before = Router.state;
    const app = Application.create({ env: "test" });
    expect(Router.state).toBe(app.routerState);
    Router.get("/owned", C as never, "handle");
    Application._resetInstance();
    expect(Router.state).toBe(before);
    expect(Router.routes.has("GET /owned")).toBe(false);
  });

  it("a second app gets a fresh, isolated table", () => {
    Application._resetInstance();
    const app1 = Application.create({ env: "test" });
    Router.get("/in-app1", C as never, "handle");
    Application._resetInstance();
    const app2 = Application.create({ env: "test" });
    expect(app2.routerState).not.toBe(app1.routerState);
    expect(Router.routes.has("GET /in-app1")).toBe(false);
    Router.get("/in-app2", C as never, "handle");
    expect(app1.routerState.routes.has("GET /in-app2")).toBe(false);
    expect(app2.routerState.routes.has("GET /in-app2")).toBe(true);
  });
});
