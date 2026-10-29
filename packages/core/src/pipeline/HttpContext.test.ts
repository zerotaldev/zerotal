import { describe, it, expect, afterEach } from "bun:test";
import { HttpContext } from "./HttpContext.ts";
import { Application } from "../application/Application.ts";
import { withApp, setDefaultApp } from "../application/currentApp.ts";
import { _clientIp } from "../middleware/ThrottleMiddleware.ts";

describe("HttpContext.json()", () => {
  it("sets a JSON response with default status 200", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx.json({ ok: true });
    expect(ctx.response).toBeDefined();
    expect(ctx.response!.status).toBe(200);
    expect(ctx.response!.headers.get("Content-Type")).toContain("application/json");
  });
  it("accepts a custom status code", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx.json({ errors: { email: "taken" } }, 422);
    expect(ctx.response!.status).toBe(422);
  });
  it("serialises the payload to JSON", async () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx.json({ name: "Alice", score: 42 });
    const body = (await ctx.response!.json()) as { name: string; score: number };
    expect(body.name).toBe("Alice");
    expect(body.score).toBe(42);
  });
});

describe("HttpContext.redirect()", () => {
  it("sets a 302 redirect by default", () => {
    const ctx = HttpContext.fake("http://localhost/login");
    ctx.redirect("/dashboard");
    expect(ctx.response!.status).toBe(302);
    expect(ctx.response!.headers.get("Location")).toBe("/dashboard");
  });
  it("accepts a custom status code", () => {
    const ctx = HttpContext.fake("http://localhost/form");
    ctx.redirect("/success", 303);
    expect(ctx.response!.status).toBe(303);
    expect(ctx.response!.headers.get("Location")).toBe("/success");
  });
  it("accepts 301, 307, 308 status codes", () => {
    const ctx = HttpContext.fake("http://localhost/old");
    ctx.redirect("/new", 301);
    expect(ctx.response!.status).toBe(301);
    const ctx2 = HttpContext.fake("http://localhost/temp");
    ctx2.redirect("/other", 307);
    expect(ctx2.response!.status).toBe(307);
  });
});

describe("HttpContext.back()", () => {
  it("redirects to the Referer header with default 302", () => {
    const ctx = HttpContext.fake("http://localhost/posts", {
      headers: { Referer: "http://localhost/posts/create" },
    });
    ctx.back();
    expect(ctx.response!.status).toBe(302);
    expect(ctx.response!.headers.get("Location")).toBe("http://localhost/posts/create");
  });
  it('falls back to "/" when no Referer header', () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    ctx.back();
    expect(ctx.response!.headers.get("Location")).toBe("/");
  });
  it("accepts a custom status code", () => {
    const ctx = HttpContext.fake("http://localhost/form", {
      headers: { Referer: "http://localhost/form" },
    });
    ctx.back(303);
    expect(ctx.response!.status).toBe(303);
  });
  it("returns void", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    const result = ctx.back();
    expect(result).toBeUndefined();
  });
});

describe("HttpContext.flash()", () => {
  it("writes to session when one is attached", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    const stored: Record<string, unknown> = {};
    (ctx as unknown as { session: { flash(k: string, v: unknown): void } }).session = {
      flash: (k, v) => {
        stored[k] = v;
      },
    };
    ctx.flash("success", "Post created!");
    expect(stored["success"]).toBe("Post created!");
  });
  it("silently no-ops when no session is attached", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(() => ctx.flash("key", "value")).not.toThrow();
  });
  it("stores complex values (objects, arrays)", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    const stored: Record<string, unknown> = {};
    (ctx as unknown as { session: { flash(k: string, v: unknown): void } }).session = {
      flash: (k, v) => {
        stored[k] = v;
      },
    };
    const errors = { email: "Taken", name: "Too short" };
    ctx.flash("errors", errors);
    expect(stored["errors"]).toEqual(errors);
  });
});

describe("HttpContext.flashed()", () => {
  it("reads from session when one is attached", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    (ctx as unknown as { session: { get<T>(k: string): T | undefined } }).session = {
      get: <T>(k: string): T | undefined => {
        if (k === "success") return "Post saved!" as unknown as T;
        return undefined;
      },
    };
    expect(ctx.flashed<string>("success")).toBe("Post saved!");
  });
  it("returns undefined when no session is attached", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.flashed("key")).toBeUndefined();
  });
  it("returns undefined for missing key", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    (ctx as unknown as { session: { get<T>(k: string): T | undefined } }).session = {
      get: () => undefined,
    };
    expect(ctx.flashed("missing")).toBeUndefined();
  });
});

describe("HttpContext.query()", () => {
  it("returns the query-string value", () => {
    const ctx = HttpContext.fake("http://localhost/posts?page=3");
    expect(ctx.query("page")).toBe("3");
  });
  it("returns fallback when absent", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.query("page", "1")).toBe("1");
  });
  it("returns undefined when absent and no fallback", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.query("search")).toBeUndefined();
  });
});

describe("HttpContext.integer()", () => {
  it("parses a query-string number", () => {
    const ctx = HttpContext.fake("http://localhost/posts?page=2");
    expect(ctx.integer("page")).toBe(2);
  });
  it("parses a route param number", () => {
    const ctx = HttpContext.fake("http://localhost/users/42");
    ctx.params = { id: "42" };
    expect(ctx.integer("id")).toBe(42);
  });
  it("prefers route param over query string", () => {
    const ctx = HttpContext.fake("http://localhost/users/10?id=99");
    ctx.params = { id: "10" };
    expect(ctx.integer("id")).toBe(10);
  });
  it("returns fallback for missing key", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.integer("page", 1)).toBe(1);
  });
  it("returns fallback for non-numeric value", () => {
    const ctx = HttpContext.fake("http://localhost/posts?page=abc");
    expect(ctx.integer("page", 1)).toBe(1);
  });
});

describe("HttpContext.string()", () => {
  it("reads from query string", () => {
    const ctx = HttpContext.fake("http://localhost/posts?search=bun");
    expect(ctx.string("search")).toBe("bun");
  });
  it("reads from route params", () => {
    const ctx = HttpContext.fake("http://localhost/posts/hello-world");
    ctx.params = { slug: "hello-world" };
    expect(ctx.string("slug")).toBe("hello-world");
  });
  it("returns fallback when absent", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.string("sort", "asc")).toBe("asc");
  });
});

describe("HttpContext.boolean()", () => {
  it.each([["1"], ["true"], ["yes"], ["on"], ["TRUE"], ["YES"]])('returns true for "%s"', (val) => {
    const ctx = HttpContext.fake(`http://localhost/?active=${val}`);
    expect(ctx.boolean("active")).toBe(true);
  });
  it.each([["0"], ["false"], ["no"], ["off"], [""]])('returns false for "%s"', (val) => {
    const ctx = HttpContext.fake(`http://localhost/?active=${val}`);
    expect(ctx.boolean("active")).toBe(false);
  });
  it("returns fallback when absent", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(ctx.boolean("active", true)).toBe(true);
    expect(ctx.boolean("active")).toBe(false);
  });
});

describe("HttpContext URI helpers", () => {
  it("path() returns the pathname", () => {
    const ctx = HttpContext.fake("http://localhost/posts/42?sort=asc");
    expect(ctx.path()).toBe("/posts/42");
  });
  it("fullUrl() returns href including query string", () => {
    const ctx = HttpContext.fake("http://localhost/posts?page=2");
    expect(ctx.fullUrl()).toBe("http://localhost/posts?page=2");
  });
  it("host() returns hostname (+ port if non-standard)", () => {
    const ctx = HttpContext.fake("http://api.example.com:8080/v1");
    expect(ctx.host()).toBe("api.example.com:8080");
  });
});

describe("HttpContext.is()", () => {
  it("matches an exact path", () => {
    const ctx = HttpContext.fake("http://localhost/dashboard");
    expect(ctx.is("/dashboard")).toBe(true);
  });
  it("* matches a single path segment (not slashes)", () => {
    const ctx = HttpContext.fake("http://localhost/admin/users");
    expect(ctx.is("/admin/*")).toBe(true);
    expect(ctx.is("/admin/*/*")).toBe(false);
  });
  it("** matches across slashes", () => {
    const ctx = HttpContext.fake("http://localhost/posts/1/comments/5");
    expect(ctx.is("/posts/**")).toBe(true);
  });
  it("returns false when the path does not match", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.is("/admin/*")).toBe(false);
  });
  it("escapes regex special chars in the pattern", () => {
    const ctx = HttpContext.fake("http://localhost/v1.0/status");
    expect(ctx.is("/v1.0/status")).toBe(true);
    expect(ctx.is("/v10/status")).toBe(false);
  });
});

describe("HttpContext header helpers", () => {
  it("header() returns the header value", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { "X-Custom": "hello" },
    });
    expect(ctx.header("X-Custom")).toBe("hello");
  });
  it("header() returns fallback for absent header", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(ctx.header("X-Missing")).toBeNull();
    expect(ctx.header("X-Missing", "default")).toBe("default");
  });
  it("bearerToken() extracts the token from Authorization header", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Authorization: "Bearer abc123token" },
    });
    expect(ctx.bearerToken()).toBe("abc123token");
  });
  it("bearerToken() returns null when header is absent", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(ctx.bearerToken()).toBeNull();
  });
  it("bearerToken() returns null for non-Bearer schemes", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(ctx.bearerToken()).toBeNull();
  });
});

describe("HttpContext content negotiation", () => {
  it("isJson() returns true when Content-Type is application/json", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    expect(ctx.isJson()).toBe(true);
  });
  it("isJson() returns false for other content types", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data" },
    });
    expect(ctx.isJson()).toBe(false);
  });
  it("wantsJson() returns true when Accept includes application/json", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Accept: "application/json, text/plain" },
    });
    expect(ctx.wantsJson()).toBe(true);
  });
  it("wantsJson() returns false for HTML-accepting requests", () => {
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(ctx.wantsJson()).toBe(false);
  });
});

describe("HttpContext.input()", () => {
  it("reads from route params first", () => {
    const ctx = HttpContext.fake("http://localhost/users/42?id=99");
    ctx.params = { id: "42" };
    expect(ctx.input("id")).toBe("42");
  });
  it("reads from cached body when params miss", async () => {
    const ctx = HttpContext.fake("http://localhost/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    await ctx.body();
    expect(ctx.input("title")).toBe("Hello");
  });
  it("reads from query string when params and body both miss", () => {
    const ctx = HttpContext.fake("http://localhost/posts?page=3");
    expect(ctx.input("page")).toBe("3");
  });
  it("reads only own fields, not ones every object inherits", async () => {
    const ctx = HttpContext.fake("http://localhost/posts?toString=from-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    await ctx.body();
    expect(ctx.input("toString")).toBe("from-query");
    expect(ctx.input("constructor", "fallback")).toBe("fallback");
    expect(ctx.input("hasOwnProperty")).toBeUndefined();
  });
  it("returns fallback when key is absent everywhere", () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    expect(ctx.input("missing", "default")).toBe("default");
    expect(ctx.input("missing")).toBeUndefined();
  });
  it("does NOT read uncached body (avoids async surprise)", () => {
    const ctx = HttpContext.fake("http://localhost/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(ctx.input("title")).toBeUndefined();
  });
});

describe("HttpContext.body()", () => {
  it("parses JSON body", async () => {
    const ctx = HttpContext.fake("http://localhost/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "a@b.com" }),
    });
    const b = await ctx.body<{ name: string; email: string }>();
    expect(b.name).toBe("Alice");
    expect(b.email).toBe("a@b.com");
  });
  it("returns {} for empty/non-JSON body", async () => {
    const ctx = HttpContext.fake("http://localhost/users", { method: "POST" });
    const b = await ctx.body();
    expect(b).toEqual({});
  });
  it("caches the result across multiple calls", async () => {
    const ctx = HttpContext.fake("http://localhost/users", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
    });
    const b1 = await ctx.body();
    const b2 = await ctx.body();
    expect(b1).toBe(b2);
  });
});

// A client can send any JSON value. A bare number, string, boolean or null has no fields: cached
// as is, it broke the Record body() promises and made input() throw on `key in 5`, a 500.
describe("HttpContext body() and input() on a JSON body that is not an object", () => {
  const send = (raw: string) =>
    HttpContext.fake("http://localhost/items?q=fromquery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });

  for (const raw of ["5", '"str"', "true", "null"]) {
    it(`body() returns {} and input() falls back to the query for ${raw}`, async () => {
      const ctx = send(raw);
      expect(await ctx.body()).toEqual({});
      expect(ctx.input("q")).toBe("fromquery");
      expect(ctx.input("missing", "fallback")).toBe("fallback");
    });
  }

  it("body() returns {} for a null body, so destructuring it is safe", async () => {
    const { title } = await send("null").body<{ title?: string }>();
    expect(title).toBeUndefined();
  });

  it("body() returns a JSON array as sent, and input() reads no field from it", async () => {
    const ctx = send("[1,2]");
    expect(await ctx.body<Record<string, unknown>>()).toEqual([1, 2]);
    expect(ctx.input("q")).toBe("fromquery");
    expect(ctx.input("0", "fallback")).toBe("fallback");
    expect(ctx.input("length", "fallback")).toBe("fallback");
  });

  it("an object body still wins over the query", async () => {
    const ctx = send(JSON.stringify({ q: "frombody" }));
    expect(await ctx.body()).toEqual({ q: "frombody" });
    expect(ctx.input("q")).toBe("frombody");
  });

  it("a primed body that is not an object caches as {}", async () => {
    const ctx = send("5");
    const primed: unknown = 5;
    ctx._primeBody(primed as Record<string, unknown>);
    expect(await ctx.body()).toEqual({});
    expect(ctx.input("q")).toBe("fromquery");
  });
});

describe("HttpContext.took", () => {
  it("returns a non-negative number of elapsed milliseconds", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(typeof ctx.took).toBe("number");
    expect(ctx.took).toBeGreaterThanOrEqual(0);
  });
});

describe("HttpContext.url", () => {
  it("is a URL instance parsed from the request URL", () => {
    const ctx = HttpContext.fake("http://localhost/path?q=1");
    expect(ctx.url).toBeInstanceOf(URL);
    expect(ctx.url.pathname).toBe("/path");
    expect(ctx.url.searchParams.get("q")).toBe("1");
  });
});

describe("HttpContext.markdown()", () => {
  it("sets an HTML response from markdown content", async () => {
    const ctx = HttpContext.fake("http://localhost/docs");
    ctx.markdown("# Hello World");
    expect(ctx.response).toBeDefined();
    expect(ctx.response?.status).toBe(200);
    const text = await ctx.response?.text();
    expect(text).toContain("Hello World");
  });
  it("uses the provided title in the page HTML", async () => {
    const ctx = HttpContext.fake("http://localhost/docs");
    ctx.markdown("Some content", { title: "My Docs Page" });
    const text = await ctx.response?.text();
    expect(text).toContain("My Docs Page");
  });
  it("respects a custom status code", () => {
    const ctx = HttpContext.fake("http://localhost/docs");
    ctx.markdown("content", {}, 201);
    expect(ctx.response?.status).toBe(201);
  });
});

describe("HttpContext.ip()", () => {
  it("returns null when no server reference is injected", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    expect(ctx.ip()).toBeNull();
  });
  it("returns the socket address when a RequestIPProvider is injected", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx._server = {
      requestIP: (_req: Request) => ({ address: "203.0.113.42", family: "IPv4", port: 54321 }),
    };
    expect(ctx.ip()).toBe("203.0.113.42");
  });
  it("returns null when requestIP() returns null", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx._server = {
      requestIP: (_req: Request) => null,
    };
    expect(ctx.ip()).toBeNull();
  });
  it("handles IPv6 addresses", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    ctx._server = {
      requestIP: (_req: Request) => ({ address: "::1", family: "IPv6", port: 443 }),
    };
    expect(ctx.ip()).toBe("::1");
  });
});

// ── HttpContext.html() ────────────────────────────────────────────────────────

describe("HttpContext.html()", () => {
  it("sets an HTML response with default 200 status", () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.html("<p>Hello</p>");
    expect(ctx.response?.status).toBe(200);
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
  });

  it("accepts a custom status code", () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.html("<h1>Not Found</h1>", 404);
    expect(ctx.response?.status).toBe(404);
  });

  it("accepts an object with toString()", async () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.html({ toString: () => "<b>rendered</b>" });
    const body = await ctx.response?.text();
    expect(body).toBe("<b>rendered</b>");
  });
});

// ── HttpContext.model() ───────────────────────────────────────────────────────

describe("HttpContext.model()", () => {
  it("returns the bound model when present", () => {
    const ctx = HttpContext.fake("http://localhost/users/1");
    const fakeUser = { id: 1, name: "Alice" };
    ctx._models.set("user", fakeUser);
    expect(ctx.model("user")).toBe(fakeUser);
  });

  it("throws when the model binding is missing", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(() => ctx.model("post")).toThrow(/No model binding resolved/);
  });
});

// ── HttpContext._primeBody(), file(), files() ─────────────────────────────────

describe("HttpContext._primeBody()", () => {
  it("seeds the body cache so body() returns primed data without parsing", async () => {
    const ctx = HttpContext.fake("http://localhost/", { method: "POST" });
    ctx._primeBody({ primed: true });
    const b = await ctx.body();
    expect(b).toEqual({ primed: true });
  });
});

describe("HttpContext.file()", () => {
  it("returns null when request body is not multipart", async () => {
    const ctx = HttpContext.fake("http://localhost/", { method: "POST", body: "{}" });
    const f = await ctx.file("avatar");
    expect(f).toBeNull();
  });

  it("returns null when the field is absent from FormData", async () => {
    const fd = new FormData();
    fd.append("other", "value");
    const ctx = HttpContext.fake("http://localhost/", { method: "POST", body: fd });
    const f = await ctx.file("avatar");
    expect(f).toBeNull();
  });

  it("returns an UploadedFile when a File is present", async () => {
    const fd = new FormData();
    fd.append("avatar", new File(["content"], "photo.png", { type: "image/png" }));
    const ctx = HttpContext.fake("http://localhost/", { method: "POST", body: fd });
    const f = await ctx.file("avatar");
    expect(f).not.toBeNull();
    expect(f?.originalName).toBe("photo.png");
  });
});

describe("HttpContext.files()", () => {
  it("returns empty array when request body is not multipart", async () => {
    const ctx = HttpContext.fake("http://localhost/", { method: "POST", body: "{}" });
    const files = await ctx.files("attachments");
    expect(files).toEqual([]);
  });

  it("returns multiple UploadedFiles for a multi-file field", async () => {
    const fd = new FormData();
    fd.append("attachments", new File(["a"], "a.txt", { type: "text/plain" }));
    fd.append("attachments", new File(["b"], "b.txt", { type: "text/plain" }));
    const ctx = HttpContext.fake("http://localhost/", { method: "POST", body: fd });
    const files = await ctx.files("attachments");
    expect(files).toHaveLength(2);
    expect(files[0]?.originalName).toBe("a.txt");
  });
});

// ── HttpContext.afterResponse() ───────────────────────────────────────────────

describe("HttpContext.afterResponse()", () => {
  it("registers a callback and returns this for chaining", () => {
    const ctx = HttpContext.fake("http://localhost/");
    const result = ctx.afterResponse(async () => {});
    expect(result).toBe(ctx);
    expect(ctx._afterResponseCallbacks).toHaveLength(1);
  });

  it("swallows errors inside afterResponse callbacks", async () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.afterResponse(async () => {
      throw new Error("fail silently");
    });
    // Should not throw when the callback runs
    await expect(ctx._afterResponseCallbacks[0]!()).resolves.toBeUndefined();
  });
});

// ── HttpContext internal meta store ───────────────────────────────────────────

describe("HttpContext setInternal / getInternal / deleteInternal", () => {
  it("stores and retrieves an internal value", () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.setInternal("trace-id", "abc-123");
    expect(ctx.getInternal("trace-id")).toBe("abc-123");
  });

  it("returns undefined for a missing key", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(ctx.getInternal("missing")).toBeUndefined();
  });

  it("deletes an internal value and returns this for chaining", () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.setInternal("k", "v");
    const result = ctx.deleteInternal("k");
    expect(result).toBe(ctx);
    expect(ctx.getInternal("k")).toBeUndefined();
  });

  it("reports presence with hasInternal", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(ctx.hasInternal("k")).toBe(false);
    ctx.setInternal("k", "v");
    expect(ctx.hasInternal("k")).toBe(true);
    ctx.deleteInternal("k");
    expect(ctx.hasInternal("k")).toBe(false);
  });

  it("carries the declared value type for a registered ContextRegistry key", () => {
    const ctx = HttpContext.fake("http://localhost/");
    // The registry augmentation below makes "test.answer" a typed key: setInternal
    // rejects a mismatched value at compile time and getInternal infers `number`.
    ctx.setInternal("test.answer", 42);
    const answer = ctx.getInternal("test.answer");
    expect(answer).toBe(42);
    // Type-level assertion: the inferred type is `number | undefined`, not `unknown`.
    const _typed: number | undefined = answer;
    expect(_typed).toBe(42);
  });
});

// Register a typed context key used by the test above. Kept at module scope so the
// declaration merge is visible to the whole file.
declare module "./ContextRegistry.ts" {
  interface ContextRegistry {
    "test.answer": number;
  }
}

describe("HttpContext.back() behind a proxy that terminates TLS", () => {
  /**
   * The request reaches the process as http://, the browser's Referer says
   * https://. A same-origin check alone refused every Referer in production and
   * sent every failed form to "/". The configured app.url is the app's own
   * address, so it counts as same-site — and nothing else does.
   */
  function appAt(url: string) {
    const app = Application.create({ env: "test" });
    app.container.value(
      "config" as never,
      {
        get: <T>(key: string, fallback: T): T =>
          key === "app.url" ? (url as unknown as T) : fallback,
      } as never,
    );
    return app;
  }

  const proxied = (referer: string) =>
    HttpContext.fake("http://127.0.0.1:3002/ops/settings", { headers: { Referer: referer } });

  it("goes back to the page the browser came from, named by its public https address", () => {
    Application._resetInstance();
    const app = appAt("https://shop.example");
    withApp(app, () => {
      const ctx = proxied("https://shop.example/ops/settings?tab=policy");
      ctx.back(303);
      expect(ctx.response!.headers.get("Location")).toBe(
        "https://shop.example/ops/settings?tab=policy",
      );
    });
    Application._resetInstance();
  });

  it("still refuses any other site", () => {
    Application._resetInstance();
    const app = appAt("https://shop.example");
    withApp(app, () => {
      for (const evil of [
        "https://evil.example/",
        "https://shop.example.evil.com/",
        "http://evil.example/",
      ]) {
        const ctx = proxied(evil);
        ctx.back(303);
        expect(ctx.response!.headers.get("Location")).toBe("/");
      }
    });
    Application._resetInstance();
  });

  it("behaves exactly as before with no app or no app.url", () => {
    Application._resetInstance();
    const ctx = proxied("https://shop.example/ops/settings");
    ctx.back(303);
    expect(ctx.response!.headers.get("Location")).toBe("/");
  });
});

describe("HttpContext.clientIp()", () => {
  const PEER = "10.0.0.1"; // the reverse proxy, from the app's side

  afterEach(() => {
    setDefaultApp(undefined);
  });

  function withProxies(trustedProxies: unknown): void {
    const manager = {
      get: (path: string, fallback?: unknown) =>
        path === "app.throttle" ? { trustedProxies } : fallback,
    };
    setDefaultApp({ container: { makeSync: () => manager } } as never);
  }

  function request(headers: Record<string, string>, peer: string | null = PEER): HttpContext {
    const ctx = HttpContext.fake("http://localhost/test", { headers });
    ctx._server = {
      requestIP: () => (peer ? { address: peer, family: "IPv4", port: 1234 } : null),
    };
    return ctx;
  }

  it("is the socket address with no proxies configured, whatever the client wrote", () => {
    expect(request({ "x-forwarded-for": "6.6.6.6" }).clientIp()).toBe(PEER);
  });

  it("is the client, not the proxy, behind one trusted proxy", () => {
    withProxies(1);

    expect(request({ "x-forwarded-for": "203.0.113.9" }).clientIp()).toBe("203.0.113.9");
  });

  it("ignores what the client wrote in front of the address the proxy appended", () => {
    withProxies(1);

    expect(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }).clientIp()).toBe("203.0.113.9");
  });

  it("counts two proxies from the right", () => {
    withProxies(2);

    expect(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.9" }).clientIp()).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to the socket when a trusted proxy sent no header", () => {
    withProxies(1);

    expect(request({}).clientIp()).toBe(PEER);
  });

  it("is null when the request offers no address at all", () => {
    expect(HttpContext.fake("http://localhost/test").clientIp()).toBeNull();
  });

  it("agrees with the address the throttle keys on", () => {
    withProxies(1);
    const ctx = request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });

    expect(ctx.clientIp()).toBe(_clientIp(ctx, 1));
  });
});
