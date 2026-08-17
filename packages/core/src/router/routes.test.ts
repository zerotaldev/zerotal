import { describe, it, expect, beforeEach } from "bun:test";
import { route as clientRoute, defineRoutes, hasRoute, resetRoutes } from "./routes.ts";
import { Router, route as serverRoute } from "./Router.ts";

const TABLE = {
  home: "/",
  "posts.index": "/posts",
  "posts.show": "/posts/:slug",
  "posts.comment": "/posts/:slug/comments/:id",
  "docs.show": "/docs/*",
} as const;

describe("client route() — table installation", () => {
  beforeEach(() => resetRoutes());

  it("throws with setup instructions before defineRoutes() runs", () => {
    // The one error every app hits once. It must name the fix, not just the symptom.
    expect(() => clientRoute("home")).toThrow("before the route table was installed");
    expect(() => clientRoute("home")).toThrow("defineRoutes(ROUTES)");
    expect(() => clientRoute("home")).toThrow("bun zt route:types");
  });

  it("resolves once the table is installed", () => {
    defineRoutes(TABLE);
    expect(clientRoute("posts.show", { slug: "hello" })).toBe("/posts/hello");
  });

  it("puts route() on globalThis, so call sites need no import", () => {
    // The ambient `declare global` in routes.ts is a promise TypeScript cannot
    // check: delete the assignment and every `route("home")` in every app still
    // compiles, then throws at runtime. This is the assertion that catches that.
    defineRoutes(TABLE);

    expect(typeof globalThis.route).toBe("function");
    expect(globalThis.route("posts.show", { slug: "hello" })).toBe("/posts/hello");
    // The global is the export, not a copy that could resolve a stale table.
    expect(globalThis.route).toBe(clientRoute);
  });

  it("installs the global only once the table behind it works", () => {
    // A global that exists but throws "no route table" is worse than one that
    // appears when it starts answering — the error would point at the call site
    // rather than at the missing `defineRoutes()`.
    defineRoutes({ "posts.index": "/articles" });
    expect(globalThis.route("posts.index")).toBe("/articles");
  });

  it("accepts a Map as well as the generated object", () => {
    defineRoutes(new Map([["posts.index", "/posts"]]));
    expect(clientRoute("posts.index")).toBe("/posts");
  });

  it("re-installing replaces the table (hot reload re-runs the entry)", () => {
    defineRoutes({ "posts.index": "/posts" });
    defineRoutes({ "posts.index": "/articles" });
    expect(clientRoute("posts.index")).toBe("/articles");
  });

  it("an unknown name throws the same message the server uses", () => {
    defineRoutes(TABLE);
    expect(() => clientRoute.dynamic("nope")).toThrow('Named route not found: "nope"');
  });
});

describe("client route() — hasRoute", () => {
  beforeEach(() => resetRoutes());

  it("reports membership of the installed table", () => {
    defineRoutes(TABLE);
    expect(hasRoute("posts.show")).toBe(true);
    expect(hasRoute("admin.index")).toBe(false);
  });

  it("returns false rather than throwing when no table is installed", () => {
    // Conditional nav should render nothing, not crash the page.
    expect(hasRoute("posts.show")).toBe(false);
  });
});

describe("client route() — URL building", () => {
  beforeEach(() => {
    resetRoutes();
    defineRoutes(TABLE);
  });

  it("substitutes multiple params", () => {
    expect(clientRoute("posts.comment", { slug: "hello", id: 7 })).toBe("/posts/hello/comments/7");
  });

  it("appends the third argument as the query string", () => {
    expect(clientRoute("posts.index", {}, { page: 2, q: "reno" })).toBe("/posts?page=2&q=reno");
  });

  it("drops null/undefined query values and repeats arrays", () => {
    expect(clientRoute("posts.index", {}, { tag: ["a", "b"], empty: null })).toBe(
      "/posts?tag=a&tag=b",
    );
  });

  it("encodes params so a value cannot mangle the URL", () => {
    expect(clientRoute("posts.show", { slug: "a/b?c" })).toBe("/posts/a%2Fb%3Fc");
  });

  it("takes a catch-all as a string or an array of segments", () => {
    expect(clientRoute("docs.show", { "*": "guides/intro" })).toBe("/docs/guides/intro");
    expect(clientRoute("docs.show", { "*": ["guides", "intro"] })).toBe("/docs/guides/intro");
  });

  it("rejects a param the pattern has no segment for", () => {
    expect(() => clientRoute("posts.show", { slug: "x", tab: "comments" })).toThrow(
      'Unknown parameter "tab"',
    );
  });

  it("throws when a required param is missing", () => {
    expect(() => clientRoute.dynamic("posts.show")).toThrow('Missing parameter "slug"');
  });
});

describe("client route() — parity with the server", () => {
  // The failure this whole split exists to prevent: a link built in the browser
  // resolving differently from the same call rendered on the server. Register
  // the routes for real, hand the client the router's own table, compare.
  beforeEach(() => {
    Router.reset();
    resetRoutes();
    class C {}
    Router.get("/", C, "home").name("home");
    Router.get("/posts", C, "index").name("posts.index");
    Router.get("/posts/:slug", C, "show").name("posts.show");
    Router.get("/posts/:slug/comments/:id", C, "comment").name("posts.comment");
    Router.get("/docs/*", C, "docs").name("docs.show");
    defineRoutes(Router.namedRoutes);
  });

  const cases: ReadonlyArray<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["home", {}, {}],
    ["posts.index", {}, { page: 2, tag: ["a", "b"], skip: null }],
    ["posts.show", { slug: "hello world" }, {}],
    ["posts.show", { slug: "a/b?c#d" }, { ref: "email" }],
    ["posts.comment", { slug: "hello", id: 42 }, {}],
    ["docs.show", { "*": "guides/intro" }, {}],
    ["docs.show", { "*": ["guides", "intro"] }, { v: 2 }],
  ];

  for (const [name, params, query] of cases) {
    it(`produces the same URL as the server for ${name} ${JSON.stringify(params)}`, () => {
      expect(clientRoute.dynamic(name, params as never, query as never)).toBe(
        serverRoute.dynamic(name, params as never, query as never),
      );
    });
  }

  it("reports the same errors as the server", () => {
    const bad = () => clientRoute.dynamic("posts.show", { slug: "x", tab: "y" });
    const badOnServer = () => serverRoute.dynamic("posts.show", { slug: "x", tab: "y" });
    let clientMessage = "";
    let serverMessage = "";
    try {
      bad();
    } catch (e) {
      clientMessage = (e as Error).message;
    }
    try {
      badOnServer();
    } catch (e) {
      serverMessage = (e as Error).message;
    }
    expect(clientMessage).toBe(serverMessage);
    expect(clientMessage).toContain('Unknown parameter "tab"');
  });
});
