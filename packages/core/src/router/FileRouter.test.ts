import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { Router } from "./Router.ts";
import { filePathToRoutePath, generateRouteName, scanFileRoutes } from "./FileRouter.ts";

// ── filePathToRoutePath ───────────────────────────────────────────────────────

describe("filePathToRoutePath", () => {
  it("index.ts → /", () => {
    expect(filePathToRoutePath("index.ts")).toBe("/");
  });

  it("about.ts → /about", () => {
    expect(filePathToRoutePath("about.ts")).toBe("/about");
  });

  it("users/index.ts → /users", () => {
    expect(filePathToRoutePath("users/index.ts")).toBe("/users");
  });

  it("users/[id].ts → /users/:id", () => {
    expect(filePathToRoutePath("users/[id].ts")).toBe("/users/:id");
  });

  it("api/users/[id]/posts.ts → /api/users/:id/posts", () => {
    expect(filePathToRoutePath("api/users/[id]/posts.ts")).toBe("/api/users/:id/posts");
  });

  it("api/users/[userId]/posts/[postId].ts → /api/users/:userId/posts/:postId", () => {
    expect(filePathToRoutePath("api/users/[userId]/posts/[postId].ts")).toBe(
      "/api/users/:userId/posts/:postId",
    );
  });

  it("(public)/about.ts strips group segment → /about", () => {
    expect(filePathToRoutePath("(public)/about.ts")).toBe("/about");
  });

  it("(admin)/users/index.ts strips group → /users", () => {
    expect(filePathToRoutePath("(admin)/users/index.ts")).toBe("/users");
  });

  it("handles Windows backslashes", () => {
    expect(filePathToRoutePath("users\\[id].ts")).toBe("/users/:id");
  });

  it("[...slug].ts → /*", () => {
    expect(filePathToRoutePath("[...slug].ts")).toBe("/*");
  });

  it("files/[...path].ts → /files/*", () => {
    expect(filePathToRoutePath("files/[...path].ts")).toBe("/files/*");
  });
});

// ── generateRouteName ─────────────────────────────────────────────────────────

describe("generateRouteName", () => {
  it("/ GET → home", () => {
    expect(generateRouteName("/", "GET")).toBe("home");
  });

  it("/about GET → about", () => {
    expect(generateRouteName("/about", "GET")).toBe("about");
  });

  it("/about POST → about.store", () => {
    expect(generateRouteName("/about", "POST")).toBe("about.store");
  });

  it("/api/users GET (index file) → api.users.index", () => {
    expect(generateRouteName("/api/users", "GET", true)).toBe("api.users.index");
  });

  it("/api/users GET (leaf file) → api.users", () => {
    expect(generateRouteName("/api/users", "GET", false)).toBe("api.users");
  });

  it("/api/users POST → api.users.store", () => {
    expect(generateRouteName("/api/users", "POST")).toBe("api.users.store");
  });

  it("/api/users/:id GET → api.users.show", () => {
    expect(generateRouteName("/api/users/:id", "GET")).toBe("api.users.show");
  });

  it("/api/users/:id PUT → api.users.update", () => {
    expect(generateRouteName("/api/users/:id", "PUT")).toBe("api.users.update");
  });

  it("/api/users/:id PATCH → api.users.update", () => {
    expect(generateRouteName("/api/users/:id", "PATCH")).toBe("api.users.update");
  });

  it("/api/users/:id DELETE → api.users.destroy", () => {
    expect(generateRouteName("/api/users/:id", "DELETE")).toBe("api.users.destroy");
  });

  it("/blog/posts/:id GET → blog.posts.show", () => {
    expect(generateRouteName("/blog/posts/:id", "GET")).toBe("blog.posts.show");
  });
});

// ── scanFileRoutes ────────────────────────────────────────────────────────────
// Creates real .ts files in a temp directory, scans them, then checks Router.

const TMP = `.tmp-file-router-test-${Date.now()}`;

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
  Router.reset();
});

beforeEach(() => {
  Router.reset();
});

describe("scanFileRoutes — route registration", () => {
  it("registers GET from a named export", async () => {
    await Bun.write(`${TMP}/users/index.ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);
    expect(Router.routes.has("GET /users")).toBe(true);
  });

  it("registers POST from a named export", async () => {
    await Bun.write(`${TMP}/posts/index.ts`, `export function GET() {} export function POST() {}`);
    await scanFileRoutes(TMP);
    expect(Router.routes.has("GET /posts")).toBe(true);
    expect(Router.routes.has("POST /posts")).toBe(true);
  });

  it("converts [id] to :id in the registered path", async () => {
    await Bun.write(`${TMP}/items/[id].ts`, `export function GET() {} export function DELETE() {}`);
    await scanFileRoutes(TMP);
    expect(Router.routes.has("GET /items/:id")).toBe(true);
    expect(Router.routes.has("DELETE /items/:id")).toBe(true);
  });

  it("strips (group) directories from the URL path", async () => {
    await Bun.write(`${TMP}/(auth)/login.ts`, `export function GET() {} export function POST() {}`);
    await scanFileRoutes(TMP);
    expect(Router.routes.has("GET /login")).toBe(true);
    expect(Router.routes.has("POST /login")).toBe(true);
    // group prefix must NOT appear in the path
    expect(Router.routes.has("GET /(auth)/login")).toBe(false);
  });

  it("registers default export as GET when no GET export exists", async () => {
    await Bun.write(`${TMP}/home.ts`, `export default function handler() {}`);
    await scanFileRoutes(TMP);
    expect(Router.routes.has("GET /home")).toBe(true);
  });

  it("does NOT register default as GET when GET is already exported", async () => {
    await Bun.write(`${TMP}/widget.ts`, `export function GET() {} export default function d() {}`);
    await scanFileRoutes(TMP);
    // Only one GET entry for /widget
    expect(Router.routes.has("GET /widget")).toBe(true);
  });

  it("skips _middleware.ts files", async () => {
    await Bun.write(`${TMP}/_middleware.ts`, `export const middleware = [];`);
    await scanFileRoutes(TMP);
    expect([...Router.routes.keys()].some((k) => k.includes("_middleware"))).toBe(false);
  });

  it("skips *.test.ts files", async () => {
    await Bun.write(`${TMP}/users.test.ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);
    expect([...Router.routes.keys()].some((k) => k.includes("users.test"))).toBe(false);
  });

  it("skips _private.ts files", async () => {
    await Bun.write(`${TMP}/_helpers.ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);
    expect([...Router.routes.keys()].some((k) => k.includes("_helpers"))).toBe(false);
  });

  it("returns a count of registered handlers", async () => {
    await Bun.write(`${TMP}/count/index.ts`, `export function GET() {} export function POST() {}`);
    const count = await scanFileRoutes(TMP);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("applies per-file `export const middleware` (array) to every method", async () => {
    await Bun.write(
      `${TMP}/guarded/index.ts`,
      `class AuthMw { async handle(_c, n) { return n(); } }
       export const middleware = [AuthMw];
       export function GET() {} export function POST() {}`,
    );
    await scanFileRoutes(TMP);
    const get = Router.middlewareFor("GET", "/guarded").map((m) => m.name);
    const post = Router.middlewareFor("POST", "/guarded").map((m) => m.name);
    expect(get).toEqual(["AuthMw"]);
    expect(post).toEqual(["AuthMw"]);
  });

  it("applies per-file middleware map (ALL + per-method)", async () => {
    await Bun.write(
      `${TMP}/api/index.ts`,
      `class AuthMw { async handle(_c, n) { return n(); } }
       class WriteMw { async handle(_c, n) { return n(); } }
       export const middleware = { ALL: [AuthMw], POST: [WriteMw] };
       export function GET() {} export function POST() {}`,
    );
    await scanFileRoutes(TMP);
    expect(Router.middlewareFor("GET", "/api").map((m) => m.name)).toEqual(["AuthMw"]);
    expect(Router.middlewareFor("POST", "/api").map((m) => m.name)).toEqual(["AuthMw", "WriteMw"]);
  });

  it("stacks _middleware.ts before per-file middleware", async () => {
    await Bun.write(
      `${TMP}/stacked/_middleware.ts`,
      `class DirMw { async handle(_c, n) { return n(); } }
       export const middleware = [DirMw];`,
    );
    await Bun.write(
      `${TMP}/stacked/index.ts`,
      `class FileMw { async handle(_c, n) { return n(); } }
       export const middleware = [FileMw];
       export function GET() {}`,
    );
    await scanFileRoutes(TMP);
    expect(Router.middlewareFor("GET", "/stacked").map((m) => m.name)).toEqual(["DirMw", "FileMw"]);
  });
  it("applies a _middleware.tsx file, not only _middleware.ts", async () => {
    // The scanner skips _middleware.* as a route but only probed the .ts spelling when
    // collecting, so a JSX-authored guard was silently never applied — its sibling routes
    // stayed live and unguarded, with no error and no log.
    await Bun.write(
      `${TMP}/jsxguard/_middleware.tsx`,
      `class JsxMw { async handle(_c, n) { return n(); } }
       export const middleware = [JsxMw];`,
    );
    await Bun.write(`${TMP}/jsxguard/index.ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);

    expect(Router.middlewareFor("GET", "/jsxguard").map((m) => m.name)).toEqual(["JsxMw"]);
    expect([...Router.routes.keys()].some((k) => k.includes("_middleware"))).toBe(false);
  });
});

describe("scanFileRoutes — auto-naming and meta overrides", () => {
  it("auto-names a simple GET route", async () => {
    await Bun.write(`${TMP}/named/about.ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);
    const def = Router.routes.get("GET /named/about");
    expect(def?.name).toBe("named.about");
  });

  it("auto-names a parameterised GET route with .show suffix", async () => {
    await Bun.write(`${TMP}/named/products/[id].ts`, `export function GET() {}`);
    await scanFileRoutes(TMP);
    const def = Router.routes.get("GET /named/products/:id");
    expect(def?.name).toBe("named.products.show");
  });

  it("respects meta.GET.name override", async () => {
    await Bun.write(
      `${TMP}/named/override/[id].ts`,
      [
        `export const meta = { GET: { name: 'products.detail' } };`,
        `export function GET() {}`,
      ].join("\n"),
    );
    await scanFileRoutes(TMP);
    const def = Router.routes.get("GET /named/override/:id");
    expect(def?.name).toBe("products.detail");
  });

  it("respects meta.DELETE.name override", async () => {
    await Bun.write(
      `${TMP}/named/del/[id].ts`,
      [
        `export const meta = { DELETE: { name: 'products.remove' } };`,
        `export function DELETE() {}`,
      ].join("\n"),
    );
    await scanFileRoutes(TMP);
    const def = Router.routes.get("DELETE /named/del/:id");
    expect(def?.name).toBe("products.remove");
  });
});

// ── registerFileRouteResolver + resolver invocation ───────────────────────────

import { registerFileRouteResolver, _resetFileRouteResolvers } from "./FileRouter.ts";
import { enableFileRouteLayouts, _resetFileRouteLayouts } from "./FileRouter.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("registerFileRouteResolver — resolver is called during scanFileRoutes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "reno-resolver-"));
    Router.reset();
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("registerFileRouteResolver() stores the resolver and it is called during scan", async () => {
    const claims: string[] = [];

    registerFileRouteResolver(({ urlPath }) => {
      claims.push(urlPath);
      return false; // don't claim — let normal registration proceed
    });

    await Bun.write(join(tmpDir, "hello.ts"), "export function GET() {}");
    await scanFileRoutes(tmpDir);

    expect(claims.some((p) => p.includes("hello"))).toBe(true);
  });

  it("resolver that claims a file increments the count", async () => {
    registerFileRouteResolver(() => true); // claim everything

    await Bun.write(join(tmpDir, "claimed.ts"), "export function GET() {}");
    const count = await scanFileRoutes(tmpDir);

    expect(count).toBeGreaterThan(0);
  });

  it("resolver error is caught and scan continues", async () => {
    registerFileRouteResolver(() => {
      throw new Error("resolver boom");
    });

    await Bun.write(join(tmpDir, "safe.ts"), "export function GET() {}");
    // Should not throw even with a broken resolver
    await expect(scanFileRoutes(tmpDir)).resolves.toBeGreaterThanOrEqual(0);
  });

  it("passes per-file `export const middleware` to the resolver (e.g. Flow pages)", async () => {
    _resetFileRouteResolvers(); // isolate from resolvers leaked by earlier tests
    let captured: string[] = [];
    registerFileRouteResolver(({ middleware }) => {
      captured = middleware.map((m) => m.name);
      return true; // claim the file, like the Flow page resolver does
    });

    await Bun.write(
      join(tmpDir, "secured.ts"),
      `class PageGuard { async handle(_c, n) { return n(); } }
       export const middleware = [PageGuard];
       export default class Page {}`,
    );
    await scanFileRoutes(tmpDir);

    expect(captured).toEqual(["PageGuard"]);
    _resetFileRouteResolvers();
  });
});

// ── generateRouteName edge cases (line 173) ───────────────────────────────────

describe("generateRouteName — index collection endpoint edge case", () => {
  it("index file with multi-segment base gets .index suffix", () => {
    // e.g., api/users/index.ts → base = 'api.users', isIndex = true
    // The branch: (isIndex && base.includes('.')) ? `${base}.index` : base
    const name = generateRouteName("/api/users", "GET", true);
    expect(name).toBe("api.users.index");
  });

  it('index file at root (no dot in base) resolves to "home"', () => {
    const name = generateRouteName("/", "GET", true);
    expect(name).toBe("home");
  });
});

// ── Line 173: generateRouteName DELETE without param ──────────────────────────

describe("generateRouteName — non-GET/POST without params", () => {
  it("DELETE on a plain path returns base.delete", () => {
    const name = generateRouteName("/posts", "DELETE", false);
    expect(name).toBe("posts.delete");
  });

  it("PATCH on a plain path returns base.patch", () => {
    const name = generateRouteName("/posts", "PATCH", false);
    expect(name).toBe("posts.patch");
  });
});

// ── Line 264: scanFileRoutes returns 0 for non-existent directory ─────────────

describe("scanFileRoutes — non-existent base dir", () => {
  it("returns 0 when the directory does not exist", async () => {
    const count = await scanFileRoutes("/tmp/__zerotal_does_not_exist_xyz__");
    expect(count).toBe(0);
  });
});

// ── Lines 286-287: import failure catch ───────────────────────────────────────

describe("scanFileRoutes — import failure is caught and logged", () => {
  let badDir: string;

  beforeEach(async () => {
    badDir = await mkdtemp(join(tmpdir(), "reno-bad-import-"));
    Router.reset();
  });

  afterAll(async () => {
    if (badDir) await rm(badDir, { recursive: true, force: true });
  });

  it("continues scanning when a route file fails to import", async () => {
    // Write a valid file and an invalid one
    await Bun.write(join(badDir, "good.ts"), "export function GET() {}");
    // Write a file with a runtime throw at module level
    await Bun.write(join(badDir, "bad.ts"), 'throw new Error("intentional import failure");');

    // Should not throw — bad.ts is caught and skipped
    const count = await scanFileRoutes(badDir);
    // good.ts should still register (count ≥ 1)
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ── A _middleware file that cannot apply must never fail open ─────────────────

describe("scanFileRoutes — a broken _middleware file stops the boot", () => {
  // Every case here used to be swallowed: the file was written to guard a subtree,
  // nothing applied, the routes beneath answered normally, and there was no error and
  // no log to say so. Each test gets its own directory because the expected outcome is
  // a throw, which would otherwise poison every later scan of a shared one.
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zerotal-guard-"));
    Router.reset();
    await Bun.write(join(dir, "index.ts"), "export function GET() {}");
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("throws when the file default-exports instead of naming the export", async () => {
    // `export default [Mw]` is the natural guess — every route file in the same
    // directory default-exports its handler — and it was silently ignored.
    await Bun.write(
      join(dir, "_middleware.ts"),
      `class DefMw { async handle(_c, n) { return n(); } }
       export default [DefMw];`,
    );

    expect(scanFileRoutes(dir)).rejects.toThrow(/export const middleware = \[YourMiddleware\]/);
  });

  it("throws when the file exports no middleware at all", async () => {
    await Bun.write(join(dir, "_middleware.ts"), "export const notMiddleware = [];");

    expect(scanFileRoutes(dir)).rejects.toThrow(/does not export a `middleware` array/);
  });

  it("throws when `middleware` is a bare class rather than an array", async () => {
    await Bun.write(
      join(dir, "_middleware.ts"),
      `class BareMw { async handle(_c, n) { return n(); } }
       export const middleware = BareMw;`,
    );

    expect(scanFileRoutes(dir)).rejects.toThrow(/must be an array/);
  });

  it("throws, naming the cause, when the file fails to import", async () => {
    // A SyntaxError, a bad import path and a circular import all used to read as
    // "no middleware here" — on a hot-reload, a guard that was there a second ago.
    await Bun.write(
      join(dir, "_middleware.ts"),
      'throw new Error("intentional middleware import failure");',
    );

    expect(scanFileRoutes(dir)).rejects.toThrow(/intentional middleware import failure/);
  });

  it("stays silent when the directory simply has no _middleware file", async () => {
    // The other half of it: absence is the convention working, not a mistake, and
    // is the case for most directories in a route tree.
    await scanFileRoutes(dir);

    expect(Router.middlewareFor("GET", "/")).toEqual([]);
  });

  it("still applies a correctly written file", async () => {
    await Bun.write(
      join(dir, "_middleware.ts"),
      `export class OkMw { async handle(_c, n) { return n(); } }
       export const middleware = [OkMw];`,
    );
    await scanFileRoutes(dir);

    expect(Router.middlewareFor("GET", "/").map((m) => m.name)).toEqual(["OkMw"]);
  });
});

// ── A broken _layout file must not render pages without their chrome ──────────

describe("scanFileRoutes — a broken _layout file stops the boot", () => {
  // The same fail-open the `_middleware` loader had, one function up. Lower stakes —
  // a missing layout is not a missing guard — but the same silence: pages render
  // without their chrome, and on a hot-reload without chrome they had a moment ago.
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zerotal-layout-"));
    Router.reset();
    _resetFileRouteResolvers();
    // Layout discovery is opt-in, so without this the loader is never reached and
    // every assertion below would pass vacuously.
    enableFileRouteLayouts();
    await Bun.write(join(dir, "index.tsx"), "export default () => '<p>hi</p>';");
  });

  afterEach(async () => {
    _resetFileRouteLayouts();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("throws, naming the cause, when the layout fails to import", async () => {
    await Bun.write(
      join(dir, "_layout.tsx"),
      'throw new Error("intentional layout import failure");',
    );

    expect(scanFileRoutes(dir)).rejects.toThrow(/intentional layout import failure/);
  });

  it("throws when the layout default-exports nothing", async () => {
    await Bun.write(join(dir, "_layout.tsx"), "export const notALayout = 1;");

    expect(scanFileRoutes(dir)).rejects.toThrow(/does not default-export a component/);
  });

  it("still resolves a correctly written layout", async () => {
    await Bun.write(
      join(dir, "_layout.tsx"),
      "export default (ctx, { children }) => `<root>${children}</root>`;",
    );

    expect(await scanFileRoutes(dir)).toBeGreaterThanOrEqual(1);
  });

  it("stays silent when the directory simply has no layout", async () => {
    expect(await scanFileRoutes(dir)).toBeGreaterThanOrEqual(1);
  });
});
