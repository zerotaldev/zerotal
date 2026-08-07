import { describe, it, expect, beforeEach } from "bun:test";
import { Router } from "./Router.ts";
import { createRouteHandler, runMiddleware } from "./RouteHandler.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";
import { Container } from "../container/Container.ts";
import type { Pipe, NextFn } from "../pipeline/types.ts";

// ── runMiddleware() ───────────────────────────────────────────────────────────

describe("runMiddleware()", () => {
  it("returns true when all middleware call next()", async () => {
    class PassThrough implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        return next();
      }
    }
    const req = new Request("http://localhost/test");
    const ctx = new HttpContext(req, new ScopedResolver());
    const result = await runMiddleware(ctx, [PassThrough]);
    expect(result).toBe(true);
  });

  it("returns false when middleware does NOT call next()", async () => {
    class Blocker implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, _next: NextFn): Promise<Response | void> {
        return new Response("blocked", { status: 403 });
      }
    }
    const req = new Request("http://localhost/test");
    const ctx = new HttpContext(req, new ScopedResolver());
    const result = await runMiddleware(ctx, [Blocker]);
    expect(result).toBe(false);
  });

  it("returns true for an empty middleware array", async () => {
    const req = new Request("http://localhost/test");
    const ctx = new HttpContext(req, new ScopedResolver());
    const result = await runMiddleware(ctx, []);
    expect(result).toBe(true);
  });

  it("passes a container when provided", async () => {
    class M implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        return next();
      }
    }
    const req = new Request("http://localhost/test");
    const ctx = new HttpContext(req, new ScopedResolver());
    const container = new Container();
    const result = await runMiddleware(ctx, [M], container);
    expect(result).toBe(true);
  });
});

// ── createRouteHandler() ──────────────────────────────────────────────────────

describe("createRouteHandler() — basic controller dispatch", () => {
  beforeEach(() => Router.reset());

  it("dispatches to a controller action and returns a response", async () => {
    class HomeController {
      index(http: HttpContext) {
        http.response = new Response("hello", { status: 200 });
      }
    }
    Router.get("/home", HomeController, "index");
    const def = Router.routes.get("GET /home")!;
    const container = new Container();
    const handler = createRouteHandler(def, container);
    const res = await handler(new Request("http://localhost/home"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("returns 204 when controller sets no response", async () => {
    class NoopController {
      handle(_args: HttpContext) {
        /* no response set */
      }
    }
    Router.get("/noop", NoopController, "handle");
    const def = Router.routes.get("GET /noop")!;
    const handler = createRouteHandler(def, new Container());
    const res = await handler(new Request("http://localhost/noop"));
    expect(res.status).toBe(204);
  });

  it("records HTTP metrics for every dispatched request", async () => {
    const { httpMetrics, _resetHttpMetrics } = await import("../metrics/HttpMetrics.ts");
    _resetHttpMetrics();
    class OkController {
      ok(http: HttpContext) {
        http.response = new Response("ok", { status: 200 });
      }
      boom(http: HttpContext) {
        http.response = new Response("no", { status: 500 });
      }
    }
    Router.get("/ok", OkController, "ok");
    Router.get("/boom", OkController, "boom");
    const c = new Container();
    const okH = createRouteHandler(Router.routes.get("GET /ok")!, c);
    const boomH = createRouteHandler(Router.routes.get("GET /boom")!, c);
    await okH(new Request("http://localhost/ok"));
    await okH(new Request("http://localhost/ok"));
    await boomH(new Request("http://localhost/boom"));

    const m = httpMetrics();
    expect(m.total).toBe(3);
    expect(m.success).toBe(2);
    expect(m.serverErrors).toBe(1);
  });

  it("falls back to new Controller() when container.make() throws", async () => {
    class FallbackController {
      index(http: HttpContext) {
        http.response = new Response("fallback", { status: 200 });
      }
    }
    Router.get("/fallback", FallbackController, "index");
    const def = Router.routes.get("GET /fallback")!;

    // Stub container.make to throw — triggers the catch-fallback at line 117
    const container = new Container();
    container.make = async (_cls: unknown) => {
      throw new Error("DI failure");
    };

    const handler = createRouteHandler(def, container);
    const res = await handler(new Request("http://localhost/fallback"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fallback");
  });

  it("handles action that returns a Response directly (line 146)", async () => {
    class ReturnController {
      greet() {
        return new Response("direct", { status: 201 });
      }
    }
    Router.get("/direct", ReturnController, "greet");
    const def = Router.routes.get("GET /direct")!;
    const handler = createRouteHandler(def, new Container());
    const res = await handler(new Request("http://localhost/direct"));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("direct");
  });

  it("renders an error page when controller action is missing", async () => {
    class EmptyController {
      // 'missing' intentionally absent
    }
    Router.get("/no-action", EmptyController, "missing" as never);
    const def = Router.routes.get("GET /no-action")!;
    const handler = createRouteHandler(def, new Container());
    const res = await handler(new Request("http://localhost/no-action"));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("uses exceptionHandler when an error occurs", async () => {
    class BrokenController {
      boom() {
        throw new Error("controller boom");
      }
    }
    Router.get("/boom", BrokenController, "boom");
    const def = Router.routes.get("GET /boom")!;

    const reported: unknown[] = [];
    const fakeHandler = {
      report: async (err: unknown) => {
        reported.push(err);
      },
      render: async (_err: unknown, _ctx: HttpContext) =>
        new Response("Custom Error", { status: 500 }),
    };

    const handler = createRouteHandler(def, new Container(), [], fakeHandler as never, undefined);
    const res = await handler(new Request("http://localhost/boom"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Custom Error");
    expect(reported).toHaveLength(1);
  });

  it("calls providerHooks.onRequestReceived and onRequestProcessed", async () => {
    class PingController {
      ping(http: HttpContext) {
        http.response = new Response("pong");
      }
    }
    Router.get("/ping", PingController, "ping");
    const def = Router.routes.get("GET /ping")!;

    const calls: string[] = [];
    const hooks = {
      onRequestReceived: async () => {
        calls.push("received");
      },
      onRequestProcessed: async () => {
        calls.push("processed");
      },
      scheduleResponseSent: () => {
        calls.push("sent");
      },
    };

    const handler = createRouteHandler(def, new Container(), [], undefined, hooks as never);
    await handler(new Request("http://localhost/ping"));
    expect(calls).toContain("received");
    expect(calls).toContain("processed");
  });
});

// ── Router route model binding (_toResolver) ──────────────────────────────────

describe("Router route model binding", () => {
  beforeEach(() => Router.reset());

  it(".bind() with a plain resolver function stores the resolver", () => {
    class PostController {
      show(_args: HttpContext) {}
    }
    const resolver = (val: string) => ({ id: Number(val) });
    Router.get("/posts/:id", PostController, "show").bind("id", resolver);
    const def = Router.routes.get("GET /posts/:id")!;
    expect(def.bindings.has("id")).toBe(true);
  });

  it(".bind() with a model class (has findOrFail) wraps it in a resolver", () => {
    class ArticleController {
      show(_args: HttpContext) {}
    }
    class Article {
      static findOrFail = (id: number) => ({ id });
    }
    Router.get("/articles/:id", ArticleController, "show").bind("id", Article as never);
    const def = Router.routes.get("GET /articles/:id")!;
    expect(def.bindings.has("id")).toBe(true);
  });

  it("model binding resolver is invoked during dispatch", async () => {
    class ArticleController {
      show(http: HttpContext) {
        const article = http.model<{ id: number }>("article");
        http.response = new Response(JSON.stringify({ id: article.id }));
      }
    }
    class Article {
      static findOrFail = (id: number) => ({ id });
    }
    Router.get("/articles/:id", ArticleController, "show").bind("article", Article as never);
    // Note: param name is 'id' in the URL, but binding key is 'article'
    // Let's match param name to binding name
    Router.reset();
    Router.get("/articles/:article", ArticleController, "show").bind("article", Article as never);
    const def = Router.routes.get("GET /articles/:article")!;

    const req = Object.assign(new Request("http://localhost/articles/42"), {
      params: { article: "42" },
    });
    const handler = createRouteHandler(def, new Container());
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBe(42);
  });
});

// ── afterResponse callbacks ────────────────────────────────────────────────────

describe("createRouteHandler() — afterResponse callbacks", () => {
  beforeEach(() => {
    Router.reset();
  });

  it("executes afterResponse callbacks after the response is returned", async () => {
    const fired: string[] = [];
    class AfterController {
      index(http: HttpContext) {
        http.afterResponse(async () => {
          fired.push("done");
        });
        http.response = new Response("ok", { status: 200 });
      }
    }
    Router.get("/after-cb", AfterController, "index");
    const def = Router.routes.get("GET /after-cb")!;
    const handler = createRouteHandler(def, new Container());
    const res = await handler(new Request("http://localhost/after-cb"));
    expect(res.status).toBe(200);
    // afterResponse is fire-and-forget; give it a tick to run
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(fired).toEqual(["done"]);
  });
});
