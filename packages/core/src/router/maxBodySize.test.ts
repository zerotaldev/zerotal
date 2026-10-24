import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "../application/Application.ts";
import { Router } from "./Router.ts";

/**
 * `Router.post(...).maxBodySize(bytes)` lets the route that needs room say so. The server is
 * started with the largest limit any route declared and the framework holds every other route
 * to its own; an app that never calls it starts the server exactly as before.
 */
type ServeOptions = {
  maxRequestBodySize: number;
  routes: Record<string, Record<string, (req: Request) => Response | Promise<Response>>>;
  fetch: (req: Request, server: unknown) => Promise<Response | undefined>;
};

const origServe = (Bun as unknown as Record<string, unknown>).serve;
let served: ServeOptions | undefined;
let reloaded: { routes: unknown } | undefined;

beforeEach(() => {
  Application._resetInstance();
  Router.reset();
  served = undefined;
  reloaded = undefined;
  (Bun as unknown as Record<string, unknown>).serve = (opts: ServeOptions) => {
    served = opts;
    return {
      stop: () => {},
      reload: (next: { routes: unknown }) => {
        reloaded = next;
      },
    };
  };
});

afterEach(() => {
  (Bun as unknown as Record<string, unknown>).serve = origServe;
  Application._resetInstance();
  Router.reset();
});

const ok = () => new Response("ok");
const withLength = (path: string, bytes: number): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body: "a".repeat(bytes),
    headers: { "Content-Length": String(bytes) },
  });

describe("Router .maxBodySize()", () => {
  it("records the limit against the route, including its group prefix", () => {
    Router.group({ prefix: "/webhooks" }, () => {
      Router.post("/inbound", ok).maxBodySize(25_000_000);
    });
    Router.post("/plain", ok);

    expect(Router._bodyLimits()).toEqual(new Map([["POST /webhooks/inbound", 25_000_000]]));
  });

  it("chains with name() and bind()", () => {
    const registration = Router.post("/hook", ok).maxBodySize(10).name("hook");

    expect(typeof registration.maxBodySize).toBe("function");
    expect(Router._bodyLimits().get("POST /hook")).toBe(10);
  });

  it("accepts 0, a route that takes no body", () => {
    Router.post("/ping", ok).maxBodySize(0);

    expect(Router._bodyLimits().get("POST /ping")).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (bytes) => {
    expect(() => Router.post("/hook", ok).maxBodySize(bytes)).toThrow(RangeError);
    expect(() => Router.post("/hook", ok).maxBodySize(bytes)).toThrow(/POST \/hook/);
  });

  it("keeps the larger limit when two domains share a path", () => {
    Router.group({ domain: "a.test" }, () => Router.post("/up", ok).maxBodySize(100));
    Router.group({ domain: "b.test" }, () => Router.post("/up", ok).maxBodySize(900));

    expect(Router._bodyLimits().get("POST /up")).toBe(900);
  });
});

describe("Application.start() and body limits", () => {
  it("starts the server with the config limit when no route declared one", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/a", ok);
    await app.start(0);

    expect(served!.maxRequestBodySize).toBe(8 * 1024 * 1024);
  });

  it("leaves the route handlers themselves in place when nothing needs holding", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/a", ok);
    await app.start(0);

    // A request over the default limit reaches Bun's own check, not a framework one.
    expect(Object.keys(served!.routes)).toContain("/a");
    const res = await served!.routes["/a"]!["POST"]!(withLength("/a", 9 * 1024 * 1024));
    expect(res.status).not.toBe(413);
  });

  it("starts the server with the largest limit any route declared", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/hook", ok).maxBodySize(25 * 1024 * 1024);
    Router.post("/small", ok).maxBodySize(1000);
    await app.start(0);

    expect(served!.maxRequestBodySize).toBe(25 * 1024 * 1024);
  });

  it("never lowers the server below the config limit", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/login", ok).maxBodySize(1000);
    await app.start(0);

    expect(served!.maxRequestBodySize).toBe(8 * 1024 * 1024);
  });

  it("holds the routes without a limit of their own to the config limit", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/hook", async () => new Response("hook")).maxBodySize(25 * 1024 * 1024);
    Router.post("/other", async () => new Response("other"));
    await app.start(0);

    const hook = await served!.routes["/hook"]!["POST"]!(withLength("/hook", 20 * 1024 * 1024));
    const other = await served!.routes["/other"]!["POST"]!(withLength("/other", 9 * 1024 * 1024));

    expect(hook.status).toBe(200);
    expect(other.status).toBe(413);
  });

  it("holds a request that matched no route to the config limit too", async () => {
    const app = Application.create({ env: "web" });
    Router.post("/hook", ok).maxBodySize(25 * 1024 * 1024);
    await app.start(0);

    const res = await served!.fetch(withLength("/nowhere", 9 * 1024 * 1024), {
      upgrade: () => false,
    });

    expect(res?.status).toBe(413);
  });

  it("does not add a check to unmatched requests when nothing raised the ceiling", async () => {
    const app = Application.create({ env: "web" });
    await app.start(0);

    const res = await served!.fetch(withLength("/nowhere", 100), { upgrade: () => false });

    expect(res?.status).toBe(404);
  });
});

describe("Application._reloadRoutes()", () => {
  it("hands Bun the wrapped table, so a reload keeps the shields and the limits", async () => {
    const app = Application.create({ env: "web" });
    await app.start(0);
    const internals = app as unknown as {
      _serveTable(table: unknown): unknown;
      _reloadRoutes(): Promise<void>;
    };
    const wrapped = { marker: "wrapped" };
    let given: unknown;
    internals._serveTable = (table) => {
      given = table;
      return wrapped;
    };

    await internals._reloadRoutes();

    expect(given).toBeDefined();
    expect(reloaded?.routes).toBe(wrapped);
  });
});
