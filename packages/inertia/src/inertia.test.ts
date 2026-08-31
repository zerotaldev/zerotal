import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { HttpContext, RequestContext, Router } from "@zerotal/core";
import {
  inertia,
  inertiaStream,
  _setHtmlTemplate,
  _getHtmlTemplate,
  _setPagesDir,
} from "./inertia.ts";
import { sharedProps } from "./SharedProps.ts";
import { AlwaysProp } from "./props/PropTypes.ts";
import { setAssetVersion } from "./version.ts";
import { InertiaMiddleware } from "./middleware/InertiaMiddleware.ts";
import { InertiaConfig } from "./config.ts";
import { SsrHandler } from "./SsrHandler.ts";
import { inertiaRoute } from "./route.ts";
import { generatePageRegistry } from "./PageRegistry.ts";
import { tmpdir } from "node:os";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ── helpers ───────────────────────────────────────────────────────────────────

function fakeCtx(url = "http://localhost/test", init: RequestInit = {}): HttpContext {
  return HttpContext.fake(url, init);
}

function inRequest<T>(ctx: HttpContext, fn: () => T): T {
  return RequestContext.run(ctx, fn);
}

// ── Template loading ──────────────────────────────────────────────────────────

describe("_setHtmlTemplate / _getHtmlTemplate", () => {
  it("stores and retrieves the template string", () => {
    _setHtmlTemplate("<html><!-- @inertia --></html>");
    expect(_getHtmlTemplate()).toContain("<!-- @inertia -->");
  });
});

// ── inertia() — first page load ───────────────────────────────────────────────

describe("inertia() — first page load (no X-Inertia header)", () => {
  beforeEach(() => {
    _setHtmlTemplate("<!DOCTYPE html><html><body><!-- @inertia --></body></html>");
    setAssetVersion("test-v1");
  });

  it("sets an HTML response on ctx", async () => {
    const ctx = fakeCtx();
    await inRequest(ctx, () => inertia("Dashboard", { count: 42 }));
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
  });

  it("injects the page object JSON into the template", async () => {
    const ctx = fakeCtx("http://localhost/dashboard");
    await inRequest(ctx, () => inertia("Dashboard", { count: 42 }));
    const body = await ctx.response!.text();
    expect(body).toContain('"component":"Dashboard"');
    expect(body).toContain('"count":42');
    expect(body).toContain('<div id="app">');
    expect(body).toContain('data-page="app"');
  });

  it("replaces <!-- @inertia --> placeholder", async () => {
    const ctx = fakeCtx();
    await inRequest(ctx, () => inertia("Home"));
    const body = await ctx.response!.text();
    expect(body).not.toContain("<!-- @inertia -->");
    expect(body).toContain('<div id="app">');
  });

  it("sets Vary: X-Inertia header", async () => {
    const ctx = fakeCtx();
    await inRequest(ctx, () => inertia("Home"));
    expect(ctx.response?.headers.get("Vary")).toBe("X-Inertia");
  });

  it("escapes dangerous characters in the JSON payload", async () => {
    const ctx = fakeCtx();
    await inRequest(ctx, () => inertia("Page", { danger: "<script>alert(1)</script>" }));
    const body = await ctx.response!.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("\\u003cscript\\u003e");
  });

  it("throws if no template has been loaded", async () => {
    _setHtmlTemplate("");
    const ctx = fakeCtx();
    await expect(inRequest(ctx, () => inertia("Page"))).rejects.toThrow("HTML template not loaded");
  });

  it("includes the asset version in the page object", async () => {
    const ctx = fakeCtx();
    await inRequest(ctx, () => inertia("Page"));
    const body = await ctx.response!.text();
    expect(body).toContain('"version":"test-v1"');
  });
});

// ── inertia() — XHR navigation ────────────────────────────────────────────────

describe("inertia() — XHR navigation (X-Inertia: true)", () => {
  beforeEach(() => {
    _setHtmlTemplate("<!DOCTYPE html><body><!-- @inertia --></body>");
    setAssetVersion("test-v2");
  });

  it("sets a JSON response on ctx", async () => {
    const ctx = fakeCtx("http://localhost/test", { headers: { "X-Inertia": "true" } });
    await inRequest(ctx, () => inertia("Dashboard", { count: 1 }));
    expect(ctx.response?.headers.get("Content-Type")).toContain("application/json");
  });

  it("sets X-Inertia: true header", async () => {
    const ctx = fakeCtx("http://localhost/test", { headers: { "X-Inertia": "true" } });
    await inRequest(ctx, () => inertia("Dashboard"));
    expect(ctx.response?.headers.get("X-Inertia")).toBe("true");
  });

  it("sets Vary: X-Inertia header", async () => {
    const ctx = fakeCtx("http://localhost/test", { headers: { "X-Inertia": "true" } });
    await inRequest(ctx, () => inertia("Dashboard"));
    expect(ctx.response?.headers.get("Vary")).toBe("X-Inertia");
  });

  it("returns the page object as JSON", async () => {
    const ctx = fakeCtx("http://localhost/dash", { headers: { "X-Inertia": "true" } });
    await inRequest(ctx, () => inertia("Dashboard", { user: "Alice" }));
    const body = JSON.parse(await ctx.response!.text()) as {
      component: string;
      props: { user: string };
      url: string;
      version: string;
    };
    expect(body.component).toBe("Dashboard");
    expect(body.props.user).toBe("Alice");
    expect(body.url).toBe("/dash");
    expect(body.version).toBe("test-v2");
  });

  it("merges shared props with page-specific props", async () => {
    const ctx = fakeCtx("http://localhost/test", { headers: { "X-Inertia": "true" } });
    (ctx as unknown as { user?: unknown }).user = { id: 1, name: "Siphesihle" };
    await inRequest(ctx, () => inertia("Profile", { score: 100 }));
    const body = JSON.parse(await ctx.response!.text()) as {
      props: { auth: { user: { id: number } }; score: number };
    };
    expect(body.props.auth.user.id).toBe(1);
    expect(body.props.score).toBe(100);
  });

  it("does NOT include HTML in the response body", async () => {
    const ctx = fakeCtx("http://localhost/test", { headers: { "X-Inertia": "true" } });
    await inRequest(ctx, () => inertia("Page"));
    const body = await ctx.response!.text();
    expect(body).not.toContain("<html");
    expect(body).not.toContain("<!DOCTYPE");
  });
});

// ── sharedProps() ─────────────────────────────────────────────────────────────

describe("sharedProps()", () => {
  it("includes auth.user when ctx.user is set", () => {
    const ctx = fakeCtx();
    (ctx as unknown as { user?: unknown }).user = { id: 42, name: "Test" };
    const shared = inRequest(ctx, () => sharedProps());
    expect(shared["auth"]).toEqual({ user: { id: 42, name: "Test" } });
  });

  it("includes auth.user as null when no user", () => {
    const ctx = fakeCtx();
    const shared = inRequest(ctx, () => sharedProps());
    expect(shared["auth"]).toEqual({ user: null });
  });

  it("includes flash success/error from session", () => {
    const ctx = fakeCtx();
    (ctx as unknown as { session: unknown }).session = {
      get: (key: string) => {
        if (key === "success") return "Saved!";
        if (key === "error") return "Failed!";
        return undefined;
      },
    };
    const shared = inRequest(ctx, () => sharedProps());
    expect((shared["flash"] as { success: string }).success).toBe("Saved!");
    expect((shared["flash"] as { error: string }).error).toBe("Failed!");
  });

  it("includes errors and old from session", () => {
    const ctx = fakeCtx();
    (ctx as unknown as { session: unknown }).session = {
      get: (key: string) => {
        if (key === "errors") return { name: "Required" };
        if (key === "old") return { name: "Alice" };
        return undefined;
      },
    };
    const shared = inRequest(ctx, () => sharedProps());
    // errors is wrapped in always() so it survives partial reloads — unwrap to assert.
    const errors = shared["errors"];
    const resolvedErrors = errors instanceof AlwaysProp ? errors.resolve() : errors;
    expect(resolvedErrors).toEqual({ name: "Required" });
    expect(shared["old"]).toEqual({ name: "Alice" });
  });

  it("_serializeUser skips functions and _-prefixed internals but keeps array data", () => {
    const ctx = fakeCtx();
    (ctx as unknown as { user?: unknown }).user = {
      id: 99,
      name: "Bob",
      doSomething: () => "fn", // function — skipped, it is a method not data
      roles: ["admin", "user"], // array — kept; see below
      _original: { id: 99, password: "$argon2id$leak" }, // ORM internal — skipped
    };
    const shared = inRequest(ctx, () => sharedProps());
    const user = (shared["auth"] as { user: Record<string, unknown> }).user;
    expect(user["id"]).toBe(99);
    expect(user["name"]).toBe("Bob");
    expect(user["doSomething"]).toBeUndefined();
    expect(user["_original"]).toBeUndefined();
    // Arrays used to be dropped wholesale on the theory that they were un-loaded relation
    // placeholders. They are not — an un-loaded relation throws from its getter and is caught
    // below. Dropping them silently discarded real data: a `permissions: string[]` column or an
    // eagerly-loaded relation vanished, so a frontend can() check read undefined.
    expect(user["roles"]).toEqual(["admin", "user"]);
  });

  it("_serializeUser routes through toJSON(), so `hidden` fields never reach the page", () => {
    // Regression guard. Walking Object.keys() on a live model bypassed BaseModel.toJSON(),
    // which is the method that honours `static hidden = ['password','rememberToken']`. Every
    // authenticated Inertia response embedded the password hash and remember token in the page
    // JSON — and in history.state along with it.
    const ctx = fakeCtx();
    (ctx as unknown as { user?: unknown }).user = {
      id: 7,
      name: "Ada",
      password: "$argon2id$should-never-ship",
      rememberToken: "secret-token",
      _original: { password: "$argon2id$should-never-ship" },
      toJSON() {
        return { id: 7, name: "Ada" }; // what a model with `hidden` actually returns
      },
    };
    const shared = inRequest(ctx, () => sharedProps());
    const user = (shared["auth"] as { user: Record<string, unknown> }).user;
    expect(user).toEqual({ id: 7, name: "Ada" });
    expect(user["password"]).toBeUndefined();
    expect(user["rememberToken"]).toBeUndefined();
    expect(JSON.stringify(shared)).not.toContain("should-never-ship");
  });

  it("_serializeUser silently skips properties with throwing getters", () => {
    const ctx = fakeCtx();
    const user = { id: 1 } as Record<string, unknown>;
    Object.defineProperty(user, "badProp", {
      get() {
        throw new Error("relation not loaded");
      },
      enumerable: true,
    });
    (ctx as unknown as { user?: unknown }).user = user;
    // Should not throw
    const shared = inRequest(ctx, () => sharedProps());
    const serialized = (shared["auth"] as { user: Record<string, unknown> }).user;
    expect(serialized["id"]).toBe(1);
    expect(serialized["badProp"]).toBeUndefined();
  });
});

// ── InertiaMiddleware ─────────────────────────────────────────────────────────

describe("InertiaMiddleware", () => {
  it("converts 302 to 303 for POST Inertia requests", async () => {
    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/form"),
      request: {
        method: "POST",
        headers: { get: (k: string) => (k === "X-Inertia" ? "true" : null) },
      },
      response: new Response(null, {
        status: 302,
        headers: { Location: "/success" },
      }),
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    expect((ctx as { response: Response }).response.status).toBe(303);
  });

  it("converts 301 to 303 for POST Inertia requests", async () => {
    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/form"),
      request: {
        method: "POST",
        headers: { get: (k: string) => (k === "X-Inertia" ? "true" : null) },
      },
      response: new Response(null, {
        status: 301,
        headers: { Location: "/success" },
      }),
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    expect((ctx as { response: Response }).response.status).toBe(303);
  });

  it("does NOT convert 302 for non-Inertia requests", async () => {
    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/form"),
      request: {
        method: "POST",
        headers: { get: () => null },
      },
      response: new Response(null, {
        status: 302,
        headers: { Location: "/success" },
      }),
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    expect((ctx as { response: Response }).response.status).toBe(302);
  });

  it("returns 409 when asset version mismatches", async () => {
    setAssetVersion("server-v2");

    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/page"),
      request: {
        method: "GET",
        headers: {
          get: (k: string) => {
            if (k === "X-Inertia") return "true";
            if (k === "X-Inertia-Version") return "client-v1";
            return null;
          },
        },
      },
      response: undefined,
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    expect((ctx as { response: Response }).response.status).toBe(409);
    expect((ctx as { response: Response }).response.headers.get("X-Inertia-Location")).toBe(
      "http://localhost/page",
    );
  });

  it("adds Vary: X-Inertia to all responses", async () => {
    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/"),
      request: {
        method: "GET",
        headers: { get: () => null },
      },
      response: new Response("ok", { status: 200 }),
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    expect((ctx as { response: Response }).response.headers.get("Vary")).toBe("X-Inertia");
  });

  it("does not overwrite an existing Vary header", async () => {
    const middleware = new InertiaMiddleware();

    const ctx = {
      url: new URL("http://localhost/"),
      request: { method: "GET", headers: { get: () => null } },
      response: new Response("ok", { status: 200, headers: { Vary: "Accept" } }),
    } as never;

    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    // Should keep original Vary value
    expect((ctx as { response: Response }).response.headers.get("Vary")).toBe("Accept");
  });

  it("passes through text/event-stream responses without rewrapping", async () => {
    const middleware = new InertiaMiddleware();
    const body = new ReadableStream();

    const ctx = {
      url: new URL("http://localhost/sse"),
      request: { method: "GET", headers: { get: () => null } },
      response: new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    } as never;

    const originalResponse = (ctx as { response: Response }).response;
    const result = await middleware.handle(
      ctx,
      async () => (ctx as { response?: Response }).response,
    );
    if (result instanceof Response) (ctx as { response?: Response }).response = result;

    // Response object must be the same reference — not re-wrapped
    expect((ctx as { response: Response }).response).toBe(originalResponse);
  });
});

// ── InertiaConfig factory ─────────────────────────────────────────────────────

describe("InertiaConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = InertiaConfig();
    expect(cfg.htmlTemplate).toBe("./resources/app.html");
    expect(cfg.version).toBe("1");
    expect(cfg.pagesDir).toBe("resources/js/pages");
    expect(cfg.ssr).toBe(false);
  });

  it("overrides work", () => {
    const cfg = InertiaConfig({ version: "2", pagesDir: "resources/pages", ssr: true });
    expect(cfg.version).toBe("2");
    expect(cfg.pagesDir).toBe("resources/pages");
    expect(cfg.ssr).toBe(true);
    expect(cfg.htmlTemplate).toBe("./resources/app.html");
  });
});

// ── SsrHandler ────────────────────────────────────────────────────────────────

describe("SsrHandler", () => {
  it("returns 400 when JSON body is invalid", async () => {
    const handler = new SsrHandler();
    const ctx = {
      request: { json: () => Promise.reject(new SyntaxError("bad json")) },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(400);
  });

  it("returns 422 when component is missing", async () => {
    const handler = new SsrHandler();
    const ctx = {
      request: { json: () => Promise.resolve({ props: {}, url: "/" }) },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(422);
  });

  it("returns 422 when component contains path traversal", async () => {
    const handler = new SsrHandler();
    const ctx = {
      request: {
        json: () => Promise.resolve({ component: "../secrets/config", props: {}, url: "/" }),
      },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(422);
  });

  it("returns 500 when component file cannot be found", async () => {
    const handler = new SsrHandler();
    const ctx = {
      request: {
        json: () => Promise.resolve({ component: "NonExistentPage", props: {}, url: "/" }),
      },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(500);
    const body = (await ctx.response!.json()) as { message: string };
    expect(body.message).toContain("SSR render failed");
  });

  it("returns 422 when component starts with /", async () => {
    const handler = new SsrHandler();
    const ctx = {
      request: { json: () => Promise.resolve({ component: "/etc/passwd", props: {}, url: "/" }) },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(422);
    const body = (await ctx.response!.json()) as { message: string };
    expect(body.message).toContain("Invalid component name");
  });
});

// ── inertiaStream() ───────────────────────────────────────────────────────────

describe("inertiaStream()", () => {
  it("throws when no template is loaded", async () => {
    _setHtmlTemplate("");
    const ctx = fakeCtx();
    await expect(inRequest(ctx, () => inertiaStream("Dashboard"))).rejects.toThrow(
      "HTML template not loaded",
    );
  });

  it("throws on path traversal in component name", async () => {
    _setHtmlTemplate("<!DOCTYPE html><body><!-- @inertia --></body>");
    const ctx = fakeCtx();
    await expect(inRequest(ctx, () => inertiaStream("../secrets/config"))).rejects.toThrow(
      "Invalid component name",
    );
  });

  it("throws when component starts with /", async () => {
    _setHtmlTemplate("<!DOCTYPE html><body><!-- @inertia --></body>");
    const ctx = fakeCtx();
    await expect(inRequest(ctx, () => inertiaStream("/absolute/path"))).rejects.toThrow(
      "Invalid component name",
    );
  });
});

// ── inertiaRoute() ───────────────────────────────────────────────────────────

describe("inertiaRoute()", () => {
  it("registers a GET route and returns a RouteRegistration", () => {
    const reg = inertiaRoute("/about", "About/Index");
    expect(reg).toBeDefined();
  });

  it("accepts static props object", () => {
    const reg = inertiaRoute("/home", "Home/Index", { greeting: "Hello" });
    expect(reg).toBeDefined();
  });

  it("accepts middleware array shorthand as 3rd arg", () => {
    class FakeMiddleware {}
    const reg = inertiaRoute("/admin", "Admin/Dashboard", [FakeMiddleware as never]);
    expect(reg).toBeDefined();
  });

  it("InertiaRouteHandler.handle() invokes inertia()", async () => {
    _setHtmlTemplate("<!DOCTYPE html><body><!-- @inertia --></body>");
    // Register a route with a unique path so we can find it in the router map
    inertiaRoute("/inertia-route-test", "RoutePage", { x: 1 });
    // Access the handler class stored in the router's state
    const routeDef = (
      Router.routes as unknown as Map<string, { controller: new () => { handle(): Promise<void> } }>
    ).get("GET /inertia-route-test");
    expect(routeDef).toBeDefined();
    const HandlerClass = routeDef!.controller;
    const handler = new HandlerClass(); // covers implicit constructor
    const ctx = fakeCtx("http://localhost/inertia-route-test");
    await inRequest(ctx, () => handler.handle()); // covers handle()
    expect(ctx.response).toBeDefined();
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
  });
});

// ── generatePageRegistry() ────────────────────────────────────────────────────

describe("generatePageRegistry()", () => {
  it("writes a pages.generated.ts with empty pages when no tsx found", async () => {
    const dir = join(tmpdir(), `reno-inertia-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await generatePageRegistry(dir);
    const content = await Bun.file(`${dir}/resources/js/pages.generated.ts`).text();
    expect(content).toContain("export const pages");
    await rm(dir, { recursive: true, force: true });
  });

  it("writes thunks for .tsx files found in the default resources/js/pages/", async () => {
    const dir = join(tmpdir(), `reno-registry2-${Date.now()}`);
    await mkdir(join(dir, "resources", "js", "pages", "Users"), { recursive: true });
    await Bun.write(
      join(dir, "resources", "js", "pages", "Users", "Index.tsx"),
      "export default function Page() {}",
    );
    await generatePageRegistry(dir);
    const content = await Bun.file(`${dir}/resources/js/pages.generated.ts`).text();
    // A nested page name is not a bare identifier, so it stays quoted.
    expect(content).toContain('"Users/Index":');
    // Import path is relative to the generated file in resources/js/.
    expect(content).toContain('import("./pages/Users/Index.tsx")');
    await rm(dir, { recursive: true, force: true });
  });

  it("honours a custom pagesDir and computes the relative import path", async () => {
    const dir = join(tmpdir(), `reno-registry3-${Date.now()}`);
    await mkdir(join(dir, "resources", "pages", "Users"), { recursive: true });
    await Bun.write(
      join(dir, "resources", "pages", "Users", "Index.tsx"),
      "export default function Page() {}",
    );
    await generatePageRegistry(dir, "resources/pages");
    const content = await Bun.file(`${dir}/resources/js/pages.generated.ts`).text();
    expect(content).toContain('"Users/Index":');
    // resources/js → resources/pages resolves to ../pages.
    expect(content).toContain('import("../pages/Users/Index.tsx")');
    await rm(dir, { recursive: true, force: true });
  });

  it("emits a file a formatter leaves alone", async () => {
    // The registry is rewritten on every dev rebuild. If its shape disagreed with the
    // app's formatter, the two would take turns rewriting it forever.
    const dir = join(tmpdir(), `reno-registry4-${Date.now()}`);
    await mkdir(join(dir, "resources", "js", "pages"), { recursive: true });
    await Bun.write(
      join(dir, "resources", "js", "pages", "Dashboard.tsx"),
      "export default function Page() {}",
    );
    await generatePageRegistry(dir);
    const content = await Bun.file(`${dir}/resources/js/pages.generated.ts`).text();

    expect(content).toContain("  Dashboard: () =>"); // bare identifier — no quotes
    // `satisfies`, not an annotation: the annotation widened every page name to
    // `string` and every default export to `unknown`, which is exactly what
    // typed props need back.
    expect(content).toContain("} satisfies Record<string, () => Promise<{ default: unknown }>>;");
    expect(content).toContain('declare module "@zerotal/inertia"');
    expect(content.endsWith("}\n")).toBe(true); // trailing newline
    await rm(dir, { recursive: true, force: true });
  });
});

// ── SsrHandler — success path (requires react fixture) ───────────────────────

describe("SsrHandler — success path", () => {
  it("renders TestPage.tsx component to HTML", async () => {
    const pagesDir = new URL("../resources/pages", import.meta.url).pathname.replace(
      /^\/([A-Z]:)/,
      "$1",
    );
    const handler = new SsrHandler({ pagesDir });
    const ctx = {
      request: {
        json: () =>
          Promise.resolve({
            component: "TestPage",
            props: { title: "SSR Test" },
            url: "/test",
          }),
      },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);
    expect(ctx.response?.status).toBe(200);
    const body = (await ctx.response!.json()) as { body: string; head: string[] };
    expect(typeof body.body).toBe("string");
    expect(body.body).toContain("test-page");
    expect(Array.isArray(body.head)).toBe(true);
  });
});

// ── inertiaStream() — success path (requires react fixture) ──────────────────

describe("inertiaStream() — success path", () => {
  beforeEach(() => {
    _setHtmlTemplate("<!DOCTYPE html><head></head><body><!-- @inertia --></body>");
    _setPagesDir(
      new URL("../resources/pages", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
  });

  afterEach(() => {
    _setHtmlTemplate("");
    _setPagesDir("");
  });

  it("streams a full HTML response with TestPage component", async () => {
    const ctx = fakeCtx("http://localhost/test-stream");
    await inRequest(ctx, () => inertiaStream("TestPage", { title: "Streamed" }));
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
    expect(ctx.response?.headers.get("Vary")).toBe("X-Inertia");
    const html = await ctx.response!.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</body>");
  });

  it("answers an X-Inertia XHR with the page object, not a document", async () => {
    // Server rendering is about the *first* arrival. A running client asks for a
    // page object, and this used to hand it a document — so the cold load looked
    // perfect and the next click did nothing, for someone already in the app.
    const ctx = fakeCtx("http://localhost/test-stream", {
      headers: { "X-Inertia": "true" },
    });
    await inRequest(ctx, () => inertiaStream("TestPage", { title: "Streamed" }));

    expect(ctx.response?.headers.get("Content-Type")).toBe("application/json");
    expect(ctx.response?.headers.get("X-Inertia")).toBe("true");
    // Without Vary a browser caches the JSON as this URL's HTML and shows a raw
    // page object on Back or Refresh.
    expect(ctx.response?.headers.get("Vary")).toBe("X-Inertia");

    const page = (await ctx.response!.json()) as { component: string; props: unknown };
    expect(page.component).toBe("TestPage");
    expect(page.props).toMatchObject({ title: "Streamed" });
  });

  it("answers the XHR identically whether the route used render or stream", async () => {
    // The two entry points implement one protocol. Anything that is true of one
    // half on `render` has to be true of it on `stream`, or picking `stream` to get
    // SSR silently changes how navigation behaves.
    const viaStream = fakeCtx("http://localhost/same", { headers: { "X-Inertia": "true" } });
    await inRequest(viaStream, () => inertiaStream("TestPage", { title: "Same" }));

    const viaRender = fakeCtx("http://localhost/same", { headers: { "X-Inertia": "true" } });
    await inRequest(viaRender, () => inertia("TestPage", { title: "Same" }));

    expect(await viaStream.response!.json()).toEqual(await viaRender.response!.json());
    expect(viaStream.response!.headers.get("Content-Type")).toBe(
      viaRender.response!.headers.get("Content-Type"),
    );
  });
});

// ── React <Head> on the server ───────────────────────────────────────────────

/**
 * The React SSR branch used to render the page component directly, which produced
 * correct body HTML and dropped every `<Head>` tag on the page: `<Head>` renders
 * nothing, it reports to a head manager it reads from context, and nothing had put
 * one there. Every page served the template's `<title>` and no description, no
 * canonical, no og: card — silently, and only to things that do not run JavaScript,
 * which is every social scraper and every `curl`.
 *
 * These pin the two halves of the fix: the tags are collected, and they *replace*
 * the template's own rather than being appended after them.
 */
describe("React <Head> reaches the served HTML", () => {
  beforeEach(() => {
    _setPagesDir(
      new URL("../resources/pages", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
  });

  afterEach(() => {
    _setHtmlTemplate("");
    _setPagesDir("");
  });

  it("streams the page's title in place of the template's", async () => {
    _setHtmlTemplate(
      "<!DOCTYPE html><head><title>Zerotal</title>" +
        '<meta name="description" content="placeholder"></head><body><!-- @inertia --></body>',
    );
    const ctx = fakeCtx("http://localhost/head");
    await inRequest(ctx, () => inertiaStream.dynamic("HeadPage", { title: "Trip to Kruger" }));
    const html = await ctx.response!.text();

    expect(html).toContain("<title data-inertia>Trip to Kruger</title>");
    // The template's title is gone, not merely outranked: a document with two
    // titles is a document with the first one.
    expect(html).not.toContain("<title>Zerotal</title>");
    expect(html.match(/<title/g)?.length).toBe(1);
  });

  it("replaces a meta the template already declares, and appends one it does not", async () => {
    _setHtmlTemplate(
      '<!DOCTYPE html><head><meta name="description" content="placeholder"></head>' +
        "<body><!-- @inertia --></body>",
    );
    const ctx = fakeCtx("http://localhost/head");
    await inRequest(ctx, () => inertiaStream.dynamic("HeadPage", { title: "Kruger" }));
    const html = await ctx.response!.text();

    expect(html).toContain("A page that describes itself.");
    expect(html).not.toContain("placeholder");
    expect(html.match(/name="description"/g)?.length).toBe(1);
    expect(html).toContain('property="og:title"');
  });

  it("serves the component's markup inside a root the client will hydrate", async () => {
    _setHtmlTemplate("<!DOCTYPE html><head></head><body><!-- @inertia --></body>");
    const ctx = fakeCtx("http://localhost/head");
    await inRequest(ctx, () => inertiaStream.dynamic("HeadPage", { title: "Kruger" }));
    const html = await ctx.response!.text();

    expect(html).toContain('<div data-server-rendered="true" id="app">');
    expect(html).toContain("head-page");
    // The boot payload precedes the component, so the browser has it first.
    expect(html.indexOf('data-page="app"')).toBeLessThan(html.indexOf("head-page"));
  });

  it("leaves the empty root unmarked, because there is nothing to hydrate", async () => {
    _setHtmlTemplate("<!DOCTYPE html><head></head><body><!-- @inertia --></body>");
    const ctx = fakeCtx("http://localhost/head");
    await inRequest(ctx, () => inertia.dynamic("HeadPage", { title: "Kruger" }));
    const html = await ctx.response!.text();

    expect(html).toContain('<div id="app"></div>');
    expect(html).not.toContain("data-server-rendered");
  });

  it("returns the head tags through the /__ssr contract too", async () => {
    const pagesDir = new URL("../resources/pages", import.meta.url).pathname.replace(
      /^\/([A-Z]:)/,
      "$1",
    );
    const handler = new SsrHandler({ pagesDir });
    const ctx = {
      request: {
        json: () =>
          Promise.resolve({ component: "HeadPage", props: { title: "Kruger" }, url: "/head" }),
      },
      response: undefined as Response | undefined,
      ip: () => "127.0.0.1",
      headers: () => undefined,
    };
    await handler.handle(ctx as never);

    const payload = (await ctx.response!.json()) as { body: string; head: string[] };
    expect(payload.head.join("")).toContain("Kruger");
    expect(payload.head.join("")).toContain('name="description"');
    // Same body shape as the Vue branch: the whole Inertia root, ready to drop in.
    expect(payload.body).toContain('data-page="app"');
    expect(payload.body).toContain('<div data-server-rendered="true" id="app">');
  });
});
