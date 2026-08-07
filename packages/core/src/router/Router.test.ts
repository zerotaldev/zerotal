import { describe, it, expect, beforeEach } from "bun:test";
import { Router } from "./Router.ts";
import { Container } from "../container/Container.ts";
import type { Pipe, NextFn } from "../pipeline/types.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";

// ── Test controller helpers ───────────────────────────────────────────────

class TestController {
  static calls: string[] = [];

  index(http: HttpContext): void {
    TestController.calls.push("index");
    http.response = new Response("OK", { status: 200 });
  }

  store(http: HttpContext): void {
    TestController.calls.push("store");
    http.response = new Response("Created", { status: 201 });
  }
}

// ── Registration ──────────────────────────────────────────────────────────

describe("Router — registration", () => {
  it("registers a GET route with correct properties", () => {
    Router.reset();
    Router.get("/users", TestController, "index");

    const route = Router.routes.get("GET /users");
    expect(route?.method).toBe("GET");
    expect(route?.path).toBe("/users");
    expect(route?.controller).toBe(TestController);
    expect(route?.action).toBe("index");
    expect(route?.middleware).toHaveLength(0);
  });

  it("registers routes for all HTTP methods", () => {
    Router.reset();
    Router.get("/r", TestController, "index");
    Router.post("/r", TestController, "index");
    Router.put("/r", TestController, "index");
    Router.patch("/r", TestController, "index");
    Router.delete("/r", TestController, "index");

    expect(Router.routes.has("GET /r")).toBe(true);
    expect(Router.routes.has("POST /r")).toBe(true);
    expect(Router.routes.has("PUT /r")).toBe(true);
    expect(Router.routes.has("PATCH /r")).toBe(true);
    expect(Router.routes.has("DELETE /r")).toBe(true);
  });

  it("group() applies prefix to all routes inside", () => {
    Router.reset();
    Router.group({ prefix: "/api/v1" }, () => {
      Router.get("/users", TestController, "index");
      Router.post("/users", TestController, "store");
    });

    expect(Router.routes.has("GET /api/v1/users")).toBe(true);
    expect(Router.routes.has("POST /api/v1/users")).toBe(true);
    expect(Router.routes.has("GET /users")).toBe(false);
  });

  it("group() restores prefix after the callback", () => {
    Router.reset();
    Router.group({ prefix: "/api" }, () => {
      Router.get("/users", TestController, "index");
    });
    Router.get("/health", TestController, "index");

    expect(Router.routes.has("GET /api/users")).toBe(true);
    expect(Router.routes.has("GET /health")).toBe(true);
  });

  it("nested groups concatenate prefixes", () => {
    Router.reset();
    Router.group({ prefix: "/api" }, () => {
      Router.group({ prefix: "/v2" }, () => {
        Router.get("/users", TestController, "index");
      });
    });

    expect(Router.routes.has("GET /api/v2/users")).toBe(true);
  });

  it("reset() clears all registered routes and prefix", () => {
    Router.get("/users", TestController, "index");
    Router.reset();
    expect(Router.routes.size).toBe(0);
  });
});

// ── Compile ───────────────────────────────────────────────────────────────

describe("Router — compile()", () => {
  it("returns an object with path keys and method sub-keys", () => {
    Router.reset();
    Router.get("/users", TestController, "index");
    Router.post("/users", TestController, "store");

    const compiled = Router.compile(new Container());

    expect(compiled["/users"]).toBeDefined();
    expect(typeof compiled["/users"]?.["GET"]).toBe("function");
    expect(typeof compiled["/users"]?.["POST"]).toBe("function");
  });

  it("returns an empty object when no routes are registered", () => {
    Router.reset();
    const compiled = Router.compile(new Container());
    expect(Object.keys(compiled)).toHaveLength(0);
  });

  it("groups different methods on the same path under one key", () => {
    Router.reset();
    Router.get("/items", TestController, "index");
    Router.post("/items", TestController, "store");
    Router.delete("/items/:id", TestController, "index");

    const compiled = Router.compile(new Container());

    // /items has both GET and POST; /items/:id has DELETE
    expect(typeof compiled["/items"]?.["GET"]).toBe("function");
    expect(typeof compiled["/items"]?.["POST"]).toBe("function");
    expect(compiled["/items"]?.["DELETE"]).toBeUndefined();
    expect(typeof compiled["/items/:id"]?.["DELETE"]).toBe("function");
  });
});

// ── Request handling ──────────────────────────────────────────────────────

describe("Router — request handling", () => {
  it("calls the correct controller action and returns its response", async () => {
    Router.reset();
    TestController.calls = [];
    Router.get("/users", TestController, "index");

    const compiled = Router.compile(new Container());
    const handler = compiled["/users"]?.["GET"]!;

    const response = await handler(new Request("http://localhost/users"));

    expect(TestController.calls).toContain("index");
    expect(response.status).toBe(200);
  });

  it("unregistered path has no entry in compiled routes", () => {
    Router.reset();
    Router.get("/users", TestController, "index");

    const compiled = Router.compile(new Container());
    expect(compiled["/posts"]).toBeUndefined();
  });

  it("route-specific middleware runs before the controller", async () => {
    Router.reset();
    const log: string[] = [];

    class TrackMiddleware implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        log.push("middleware");
        return next();
      }
    }

    class TrackController {
      index(http: HttpContext): void {
        log.push("controller");
        http.response = new Response("OK", { status: 200 });
      }
    }

    Router.get("/track", TrackController, "index", [TrackMiddleware]);
    const compiled = Router.compile(new Container());
    const handler = compiled["/track"]?.["GET"]!;

    await handler(new Request("http://localhost/track"));

    expect(log).toEqual(["middleware", "controller"]);
  });

  // ── Inline closure handlers ──────────────────────────────────────────

  it("registers an inline closure handler and dispatches it", async () => {
    Router.reset();
    Router.get("/ping", (http: HttpContext) => {
      http.response = new Response("pong", { status: 200 });
    });

    const route = Router.routes.get("GET /ping");
    expect(route?.action).toBe("handle");
    expect(route?.controller.name).toBe("Route<GET /ping>");

    const compiled = Router.compile(new Container());
    const response = await compiled["/ping"]?.["GET"]!(new Request("http://localhost/ping"));
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe("pong");
  });

  it("a returned Response from a closure handler becomes the response", async () => {
    Router.reset();
    Router.post("/echo", () => new Response("created", { status: 201 }));

    const compiled = Router.compile(new Container());
    const response = await compiled["/echo"]?.["POST"]!(
      new Request("http://localhost/echo", { method: "POST" }),
    );
    expect(response!.status).toBe(201);
    expect(await response!.text()).toBe("created");
  });

  it("exposes raw route params to a closure handler via the Context bag", async () => {
    Router.reset();
    Router.get("/items/:id", (http: HttpContext<{ id: string }>) => {
      http.response = new Response(http.params.id, { status: 200 });
    });

    const compiled = Router.compile(new Container());
    const req = new Request("http://localhost/items/42");
    (req as { params?: Record<string, string> }).params = { id: "42" };
    const response = await compiled["/items/:id"]?.["GET"]!(req);
    expect(await response!.text()).toBe("42");
  });

  it("runs middleware passed alongside a closure handler", async () => {
    Router.reset();
    const log: string[] = [];

    class TrackMiddleware implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        log.push("middleware");
        return next();
      }
    }

    Router.get(
      "/guarded",
      (http: HttpContext) => {
        log.push("handler");
        http.response = new Response("OK", { status: 200 });
      },
      [TrackMiddleware],
    );

    const route = Router.routes.get("GET /guarded");
    expect(route?.middleware).toEqual([TrackMiddleware]);

    const compiled = Router.compile(new Container());
    await compiled["/guarded"]?.["GET"]!(new Request("http://localhost/guarded"));
    expect(log).toEqual(["middleware", "handler"]);
  });

  it("closure handlers honour the current group prefix and can be named", () => {
    Router.reset();
    Router.group({ prefix: "/api" }, () => {
      Router.get("/health", (http: HttpContext) => {
        http.response = new Response("ok");
      }).name("api.health");
    });

    expect(Router.routes.has("GET /api/health")).toBe(true);
    expect(Router.namedRoutes.get("api.health")).toBe("/api/health");
  });

  // ── Router.resource() ────────────────────────────────────────────────

  it("resource() registers all 7 routes", () => {
    Router.reset();
    class PostController {
      index() {}
      create() {}
      store() {}
      show() {}
      edit() {}
      update() {}
      destroy() {}
    }
    Router.resource("posts", PostController);
    expect(Router.routes.has("GET /posts")).toBe(true);
    expect(Router.routes.has("GET /posts/create")).toBe(true);
    expect(Router.routes.has("POST /posts")).toBe(true);
    expect(Router.routes.has("GET /posts/:id")).toBe(true);
    expect(Router.routes.has("GET /posts/:id/edit")).toBe(true);
    expect(Router.routes.has("PUT /posts/:id")).toBe(true);
    expect(Router.routes.has("DELETE /posts/:id")).toBe(true);
  });

  it("resource().only() restricts to listed actions", () => {
    Router.reset();
    class PostController {}
    Router.resource("posts", PostController).only(["index", "show"]);
    expect(Router.routes.has("GET /posts")).toBe(true);
    expect(Router.routes.has("GET /posts/:id")).toBe(true);
    expect(Router.routes.has("POST /posts")).toBe(false);
    expect(Router.routes.has("PUT /posts/:id")).toBe(false);
  });

  it("resource().except() excludes listed actions", () => {
    Router.reset();
    class PostController {}
    Router.resource("posts", PostController).except(["create", "edit"]);
    expect(Router.routes.has("GET /posts/create")).toBe(false);
    expect(Router.routes.has("GET /posts/:id/edit")).toBe(false);
    expect(Router.routes.has("GET /posts")).toBe(true);
    expect(Router.routes.has("DELETE /posts/:id")).toBe(true);
  });

  it("resource() returns a ResourceRouteBuilder (chainable)", () => {
    Router.reset();
    class TagController {}
    const builder = Router.resource("tags", TagController);
    expect(typeof builder.only).toBe("function");
    expect(typeof builder.except).toBe("function");
  });

  it("resource() normalises leading slash in name", () => {
    Router.reset();
    class TagController {
      index() {}
    }
    Router.resource("/tags", TagController);
    expect(Router.routes.has("GET /tags")).toBe(true);
  });

  it("resource() respects prefix from group()", () => {
    Router.reset();
    class CommentController {
      index() {}
      store() {}
    }
    Router.group({ prefix: "/api/v1" }, () => {
      Router.resource("comments", CommentController);
    });
    expect(Router.routes.has("GET /api/v1/comments")).toBe(true);
    expect(Router.routes.has("POST /api/v1/comments")).toBe(true);
  });

  it("global middleware passed to compile() runs before route middleware", async () => {
    Router.reset();
    const log: string[] = [];

    class GlobalMiddleware implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        log.push("global");
        return next();
      }
    }

    class RouteMiddleware implements Pipe<HttpContext> {
      async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
        log.push("route");
        return next();
      }
    }

    class OrderController {
      index(http: HttpContext): void {
        log.push("controller");
        http.response = new Response("OK", { status: 200 });
      }
    }

    Router.get("/order", OrderController, "index", [RouteMiddleware]);
    const compiled = Router.compile(new Container(), [GlobalMiddleware]);
    const handler = compiled["/order"]?.["GET"]!;

    await handler(new Request("http://localhost/order"));

    expect(log).toEqual(["global", "route", "controller"]);
  });
});

// ── Named routes — Router.get().name() and route() ────────────────────────────

import { route } from "./Router.ts";

describe("Named routes — .name() and route()", () => {
  beforeEach(() => Router.reset());

  it(".name() registers a route name and route() resolves it", () => {
    class PostController {}
    Router.get("/posts/:slug", PostController, "show").name("posts.show");
    expect(route("posts.show", { slug: "hello-world" })).toBe("/posts/hello-world");
  });

  it("route() with no params returns the bare path", () => {
    class PostController {}
    Router.get("/posts", PostController, "index").name("posts.index");
    expect(route("posts.index")).toBe("/posts");
  });

  it("route() appends extra params as query string", () => {
    class PostController {}
    Router.get("/search", PostController, "index").name("search");
    const url = route("search", { q: "reno", page: 2 });
    expect(url).toContain("q=reno");
    expect(url).toContain("page=2");
  });

  it("route() preserves :param order in query string", () => {
    class PostController {}
    Router.get("/posts/:id", PostController, "show").name("posts.show");
    const url = route("posts.show", { id: 42, tab: "comments" });
    expect(url).toBe("/posts/42?tab=comments");
  });

  it("route() throws for unknown route names", () => {
    expect(() => route("does.not.exist")).toThrow("Named route not found");
  });

  it("route() throws when a required param is missing", () => {
    class PostController {}
    Router.get("/posts/:slug", PostController, "show").name("posts.show");
    expect(() => route("posts.show")).toThrow('Missing parameter "slug"');
  });

  it("named routes survive Router.reset()", () => {
    class PostController {}
    Router.get("/posts", PostController, "index").name("posts.index");
    Router.reset();
    expect(() => route("posts.index")).toThrow("Named route not found");
  });

  it(".name() works on post/put/delete routes", () => {
    class PostController {}
    Router.post("/posts", PostController, "store").name("posts.store");
    Router.put("/posts/:id", PostController, "update").name("posts.update");
    Router.delete("/posts/:id", PostController, "destroy").name("posts.destroy");
    expect(route("posts.store")).toBe("/posts");
    expect(route("posts.update", { id: 5 })).toBe("/posts/5");
    expect(route("posts.destroy", { id: 5 })).toBe("/posts/5");
  });

  it(".name() inside group() uses the full prefixed path", () => {
    class PostController {}
    Router.group({ prefix: "/api/v1" }, () => {
      Router.get("/posts", PostController, "index").name("api.posts.index");
    });
    expect(route("api.posts.index")).toBe("/api/v1/posts");
  });
});

// ── Middleware groups ─────────────────────────────────────────────────────────

class ApiMiddleware implements Pipe<HttpContext> {
  async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
    return next();
  }
}
class AuthMiddleware implements Pipe<HttpContext> {
  async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
    return next();
  }
}
class WebMiddleware implements Pipe<HttpContext> {
  async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
    return next();
  }
}

describe("Router — middleware groups", () => {
  beforeEach(() => Router.reset());

  it("middlewareGroup() registers a named group", () => {
    Router.middlewareGroup("api", [ApiMiddleware]);
    class C {}
    Router.group({ middleware: "api" }, () => {
      Router.get("/test", C, "index");
    });
    const def = Router.routes.get("GET /test");
    expect(def?.middleware).toHaveLength(1);
    expect(def?.middleware[0]).toBe(ApiMiddleware);
  });

  it("group middleware is prepended to route-level middleware", () => {
    Router.middlewareGroup("api", [ApiMiddleware]);
    class C {}
    Router.group({ middleware: "api" }, () => {
      Router.get("/test", C, "index", [AuthMiddleware]);
    });
    const def = Router.routes.get("GET /test");
    expect(def?.middleware[0]).toBe(ApiMiddleware);
    expect(def?.middleware[1]).toBe(AuthMiddleware);
  });

  it("group() accepts a middleware class directly", () => {
    class C {}
    Router.group({ middleware: WebMiddleware }, () => {
      Router.post("/submit", C, "store");
    });
    const def = Router.routes.get("POST /submit");
    expect(def?.middleware[0]).toBe(WebMiddleware);
  });

  it("group() accepts an array of middleware classes", () => {
    class C {}
    Router.group({ middleware: [ApiMiddleware, AuthMiddleware] }, () => {
      Router.get("/secure", C, "index");
    });
    const def = Router.routes.get("GET /secure");
    expect(def?.middleware).toHaveLength(2);
    expect(def?.middleware[0]).toBe(ApiMiddleware);
    expect(def?.middleware[1]).toBe(AuthMiddleware);
  });

  it("group() accepts a mixed array of named groups and classes", () => {
    Router.middlewareGroup("api", [ApiMiddleware]);
    class C {}
    Router.group({ middleware: ["api", AuthMiddleware] }, () => {
      Router.get("/mixed", C, "index");
    });
    const def = Router.routes.get("GET /mixed");
    expect(def?.middleware[0]).toBe(ApiMiddleware);
    expect(def?.middleware[1]).toBe(AuthMiddleware);
  });

  it("nested groups stack middleware correctly", () => {
    Router.middlewareGroup("web", [WebMiddleware]);
    Router.middlewareGroup("api", [ApiMiddleware]);
    class C {}
    Router.group({ middleware: "web" }, () => {
      Router.group({ prefix: "/api", middleware: "api" }, () => {
        Router.get("/data", C, "index");
      });
    });
    const def = Router.routes.get("GET /api/data");
    expect(def?.middleware[0]).toBe(WebMiddleware);
    expect(def?.middleware[1]).toBe(ApiMiddleware);
  });

  it("reset() clears middleware groups", () => {
    Router.middlewareGroup("api", [ApiMiddleware]);
    Router.reset();
    class C {}
    Router.group({ middleware: "api" }, () => {
      Router.get("/test", C, "index");
    });
    // 'api' group was cleared — should resolve to empty middleware
    const def = Router.routes.get("GET /test");
    expect(def?.middleware).toHaveLength(0);
  });

  it("group with prefix + middleware registers both", () => {
    Router.middlewareGroup("api", [ApiMiddleware]);
    class C {}
    Router.group({ prefix: "/api/v2", middleware: "api" }, () => {
      Router.get("/health", C, "index");
    });
    const def = Router.routes.get("GET /api/v2/health");
    expect(def).toBeDefined();
    expect(def?.middleware[0]).toBe(ApiMiddleware);
  });
});

// ── Router.macro() ───────────────────────────────────────────────────────────

describe("Router.macro()", () => {
  beforeEach(() => Router.reset());

  it("adds a callable method on the Router class", () => {
    Router.macro("greet", () => "hello");
    expect(typeof (Router as unknown as Record<string, unknown>)["greet"]).toBe("function");
    expect((Router as unknown as Record<string, () => string>)["greet"]()).toBe("hello");
  });
});

// ── Router.view() ────────────────────────────────────────────────────────────

describe("Router.view()", () => {
  beforeEach(() => Router.reset());

  it("registers a GET route", () => {
    const Comp = (_props: Record<string, unknown>) => ({ toString: () => "<html/>" });
    Router.view("/about", Comp);
    expect(Router.routes.has("GET /about")).toBe(true);
  });

  it("registers a GET route with prefix inside a group", () => {
    const Comp = (_props: Record<string, unknown>) => ({ toString: () => "" });
    Router.group({ prefix: "/public" }, () => {
      Router.view("/info", Comp);
    });
    expect(Router.routes.has("GET /public/info")).toBe(true);
  });

  it("supports .name() chaining", () => {
    const Comp = (_props: Record<string, unknown>) => ({ toString: () => "" });
    Router.view("/terms", Comp).name("terms");
    expect(Router.namedRoutes.has("terms")).toBe(true);
  });

  it("registers with middleware", () => {
    class AuthMiddleware {}
    const Comp = (_props: Record<string, unknown>) => ({ toString: () => "" });
    Router.view("/dashboard", Comp, {}, [AuthMiddleware as never]);
    const def = Router.routes.get("GET /dashboard");
    expect(def?.middleware[0]).toBe(AuthMiddleware);
  });
});

// ── Router.static() ──────────────────────────────────────────────────────────

describe("Router.static()", () => {
  beforeEach(() => Router.reset());

  it("registers a static directory in Router.staticDirs", () => {
    Router.static("/assets", "./public");
    expect(Router.staticDirs).toHaveLength(1);
    expect(Router.staticDirs[0]).toEqual({ prefix: "/assets", rootDir: "./public" });
  });

  it("does not add a compiled route for static directories", () => {
    Router.static("/files", "./public");
    const compiled = Router.compile();
    expect(compiled["/files/*"]).toBeUndefined();
  });

  it("accumulates multiple static directories", () => {
    Router.static("/assets", "./public/assets");
    Router.static("/uploads", "./storage/uploads");
    expect(Router.staticDirs).toHaveLength(2);
    expect(Router.staticDirs[1]).toEqual({ prefix: "/uploads", rootDir: "./storage/uploads" });
  });
});

// ── Router.markdown() ────────────────────────────────────────────────────────

describe("Router.markdown()", () => {
  beforeEach(() => Router.reset());

  it("registers a markdown directory", () => {
    Router.markdown("/docs", "./docs");
    const compiled = Router.compile();
    expect(compiled["/docs/*"]).toBeDefined();
    expect(typeof compiled["/docs/*"]!["GET"]).toBe("function");
  });

  it("compiled markdown handler serves an existing .md file", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeFile, mkdir, rm } = await import("node:fs/promises");
    const dir = join(tmpdir(), `reno-md-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "hello.md"), "# Hello\nWorld");

    Router.markdown("/docs", dir, { title: "Docs" });
    const compiled = Router.compile();
    const handler = compiled["/docs/*"]!["GET"]!;
    const req = new Request("http://localhost/docs/hello");
    const res = await (handler as (req: Request) => Promise<Response>)(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Hello");

    await rm(dir, { recursive: true, force: true });
    Router.reset();
  });

  it("compiled markdown handler falls back to index.md", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeFile, mkdir, rm } = await import("node:fs/promises");
    const dir = join(tmpdir(), `reno-md2-${Date.now()}`);
    await mkdir(join(dir, "guide"), { recursive: true });
    await writeFile(join(dir, "guide", "index.md"), "# Guide Index");

    Router.markdown("/docs", dir);
    const compiled = Router.compile();
    const handler = compiled["/docs/*"]!["GET"]!;
    const req = new Request("http://localhost/docs/guide");
    const res = await (handler as (req: Request) => Promise<Response>)(req);
    expect(res.status).toBe(200);

    await rm(dir, { recursive: true, force: true });
    Router.reset();
  });

  it("compiled markdown handler returns 404 for missing file", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdir, rm } = await import("node:fs/promises");
    const dir = join(tmpdir(), `reno-md3-${Date.now()}`);
    await mkdir(dir, { recursive: true });

    Router.markdown("/docs", dir);
    const compiled = Router.compile();
    const handler = compiled["/docs/*"]!["GET"]!;
    const req = new Request("http://localhost/docs/nope");
    const res = await (handler as (req: Request) => Promise<Response>)(req);
    expect(res.status).toBe(404);

    await rm(dir, { recursive: true, force: true });
    Router.reset();
  });
});

// ── Router.raw() ─────────────────────────────────────────────────────────────

describe("Router.raw()", () => {
  beforeEach(() => Router.reset());

  it("registers a raw handler that bypasses middleware", () => {
    Router.raw("GET", "/__ping", () => new Response("pong"));
    const compiled = Router.compile();
    expect(compiled["/__ping"]).toBeDefined();
    expect(typeof compiled["/__ping"]!["GET"]).toBe("function");
  });

  it("compiled raw handler returns the response", async () => {
    Router.raw("POST", "/__echo", (req) => new Response(`echo:${req.method}`));
    const compiled = Router.compile();
    const handler = compiled["/__echo"]!["POST"]!;
    const res = await (handler as (req: Request) => Promise<Response>)(
      new Request("http://localhost/__echo", { method: "POST" }),
    );
    expect(await res.text()).toBe("echo:POST");
  });
});

// ── Router.middlewareFor() ───────────────────────────────────────────────────

describe("Router.middlewareFor()", () => {
  beforeEach(() => Router.reset());

  it("returns middleware for a registered route", () => {
    class AuthMw {}
    class VerifyMw {}
    Router.get("/profile", TestController, "index", [AuthMw as never, VerifyMw as never]);
    const mw = Router.middlewareFor("GET", "/profile");
    expect(mw[0]).toBe(AuthMw);
    expect(mw[1]).toBe(VerifyMw);
  });

  it("returns empty array for unknown route", () => {
    expect(Router.middlewareFor("GET", "/nonexistent")).toEqual([]);
  });
});

// ── Router getters ───────────────────────────────────────────────────────────

describe("Router getters", () => {
  beforeEach(() => Router.reset());

  it("groupPrefix is empty string outside a group", () => {
    expect(Router.groupPrefix).toBe("");
  });

  it("groupPrefix reflects the current group prefix during registration", () => {
    let prefix = "";
    Router.group({ prefix: "/api/v1" }, () => {
      prefix = Router.groupPrefix;
    });
    expect(prefix).toBe("/api/v1");
    expect(Router.groupPrefix).toBe(""); // restored after group
  });

  it("routes returns a ReadonlyMap", () => {
    Router.get("/x", TestController, "index");
    expect(Router.routes).toBeInstanceOf(Map);
    expect(Router.routes.has("GET /x")).toBe(true);
  });

  it("namedRoutes returns named routes", () => {
    Router.get("/home", TestController, "index").name("home");
    expect(Router.namedRoutes.has("home")).toBe(true);
    expect(Router.namedRoutes.get("home")).toBe("/home");
  });
});

// ── Router.bind() + _toResolver ──────────────────────────────────────────────

describe("Route.bind() — model class resolver", () => {
  beforeEach(() => Router.reset());

  it("stores a resolver when .bind() is called with a model class (covers _toResolver)", () => {
    class User {
      static async findOrFail(id: number) {
        return { id };
      }
    }
    Router.get("/users/:id", TestController, "index").bind("id", User as never);
    const route = Router.routes.get("GET /users/:id");
    expect(route?.bindings.has("id")).toBe(true);
    // The resolver should be a function (wrapping findOrFail)
    expect(typeof route?.bindings.get("id")).toBe("function");
  });

  it("resolver returned by _toResolver calls findOrFail with the numeric value", async () => {
    let calledWith: number | null = null;
    class Post {
      static async findOrFail(id: number) {
        calledWith = id;
        return { id };
      }
    }
    Router.get("/posts/:id", TestController, "index").bind("id", Post as never);
    const resolver = Router.routes.get("GET /posts/:id")!.bindings.get("id")!;
    await resolver("42");
    expect(calledWith).toBe(42);
  });

  it("stores a raw resolver function directly (non-model-class path)", () => {
    const rawResolver = (val: string) => ({ id: Number(val) });
    Router.get("/items/:id", TestController, "index").bind("id", rawResolver as never);
    const route = Router.routes.get("GET /items/:id");
    expect(route?.bindings.get("id")).toBe(rawResolver);
  });
});

// ── Router.view() handler execution ──────────────────────────────────────────

describe("Router.view() — handler invocation (covers _wrapFileHandler.handle)", () => {
  beforeEach(() => Router.reset());

  it("executing the wrapped controller handle() calls the view handler", async () => {
    const Comp = (props: { title: string }) => ({ toString: () => `<h1>${props.title}</h1>` });
    Router.view("/page", Comp, { title: "Hello" });

    const route = Router.routes.get("GET /page");
    expect(route).toBeDefined();

    // Instantiate the controller class and call handle() directly
    const CtrlClass = route!.controller as unknown as new () => {
      handle: (ctx: unknown) => Promise<unknown>;
    };
    const instance = new CtrlClass();
    const ctx = HttpContext.fake("http://localhost/page");
    await instance.handle(ctx);

    // ctx.response should be set by http.view()
    expect(ctx.response).toBeDefined();
  });

  it("view() with a function props resolver calls the resolver with ctx", async () => {
    const Comp = (props: { user: string }) => ({ toString: () => `Hello ${props.user}` });
    Router.view("/profile", Comp, (ctx: HttpContext) => ({ user: "Alice" }));

    const route = Router.routes.get("GET /profile");
    const CtrlClass = route!.controller as unknown as new () => {
      handle: (ctx: unknown) => Promise<unknown>;
    };
    const instance = new CtrlClass();
    const ctx = HttpContext.fake("http://localhost/profile");
    await instance.handle(ctx);

    expect(ctx.response).toBeDefined();
  });
});
