import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { Router } from "./Router.ts";
import { scanFileRoutes, _resetFileRouteResolvers, _resetFileRouteLayouts } from "./FileRouter.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { registerViewFileRouteResolver } from "../view/index.ts";

const TMP = `.tmp-view-layout-${Date.now()}`;

async function call(routeKey: string, params: Record<string, unknown> = {}): Promise<string> {
  const def = Router.routes.get(routeKey);
  if (!def) throw new Error(`route not found: ${routeKey}`);
  const inst = new def.controller() as {
    handle: (ctx: HttpContext) => Promise<Response | void>;
  };
  const ctx = HttpContext.fake("http://localhost" + def.path.replace(/:(\w+)/g, "x"));
  ctx.params = { ...ctx.params, ...params } as never;
  const res = await inst.handle(ctx);
  const out = (res as Response | undefined) ?? ctx.response;
  return out ? await out.text() : "";
}

beforeAll(async () => {
  Router.reset();
  _resetFileRouteResolvers();
  _resetFileRouteLayouts();

  await Bun.write(
    `${TMP}/_layout.tsx`,
    "export default (ctx, { children }) => `<root>${children}</root>`;",
  );
  await Bun.write(
    `${TMP}/dash/_layout.tsx`,
    "export default (ctx, { children }) => `<dash>${children}</dash>`;",
  );
  await Bun.write(`${TMP}/home.tsx`, "export default () => '<p>H</p>';");
  await Bun.write(`${TMP}/dash/index.tsx`, "export default () => '<p>D</p>';");
  await Bun.write(
    `${TMP}/marketing/home.tsx`,
    "export const layout = (ctx, { children }) => `<m>${children}</m>`;\nexport default () => '<p>MK</p>';",
  );
  await Bun.write(
    `${TMP}/raw.tsx`,
    "export const layout = null;\nexport default () => '<x>raw</x>';",
  );
  await Bun.write(
    `${TMP}/auth/login.tsx`,
    "export default () => '<form></form>';\nexport function POST() { return new Response('posted'); }",
  );
  await Bun.write(`${TMP}/api.ts`, "export default () => new Response('plain-handler');");
  await Bun.write(
    `${TMP}/tagged.ts`,
    "const p = () => '<p>tagged</p>'; p.__zerotalViewComponent = true; export default p;",
  );

  registerViewFileRouteResolver();
  await scanFileRoutes(TMP);
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
  Router.reset();
  _resetFileRouteResolvers();
  _resetFileRouteLayouts();
});

describe("view file-route resolver", () => {
  it("renders a .tsx default export wrapped in the root _layout", async () => {
    expect(Router.routes.has("GET /home")).toBe(true);
    expect(await call("GET /home")).toBe("<root><p>H</p></root>");
  });
  it("uses the nearest _layout (dashboard layout, not root)", async () => {
    expect(await call("GET /dash")).toBe("<dash><p>D</p></dash>");
  });
  it("honours a per-file layout override", async () => {
    expect(await call("GET /marketing/home")).toBe("<m><p>MK</p></m>");
  });
  it("opts out of layouts when export const layout = null", async () => {
    expect(await call("GET /raw")).toBe("<x>raw</x>");
  });
  it("claims GET but lets a POST handler coexist in the same file", async () => {
    expect(Router.routes.has("GET /auth/login")).toBe(true);
    expect(Router.routes.has("POST /auth/login")).toBe(true);
    expect(await call("GET /auth/login")).toBe("<root><form></form></root>");
    expect(await call("POST /auth/login")).toBe("posted");
  });
  it("does not claim a plain .ts default handler", async () => {
    expect(await call("GET /api")).toBe("plain-handler");
  });
  it("claims a .ts default tagged with the view marker", async () => {
    expect(await call("GET /tagged")).toBe("<root><p>tagged</p></root>");
  });
});

describe("Router.view().withLayout()", () => {
  it("wraps an explicit view route in a layout", async () => {
    Router.reset();
    Router.view("/about", () => "<h1>About</h1>").withLayout(
      (_ctx, { children }) => `<shell>${children}</shell>`,
    );
    const def = Router.routes.get("GET /about")!;
    const inst = new def.controller() as {
      handle: (ctx: HttpContext) => Promise<void>;
    };
    const ctx = HttpContext.fake("http://localhost/about");
    await inst.handle(ctx);
    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<shell><h1>About</h1></shell>");
  });
  it("renders without a layout when none is set", async () => {
    Router.reset();
    Router.view("/plain", () => "<h1>Plain</h1>");
    const def = Router.routes.get("GET /plain")!;
    const inst = new def.controller() as {
      handle: (ctx: HttpContext) => Promise<void>;
    };
    const ctx = HttpContext.fake("http://localhost/plain");
    await inst.handle(ctx);
    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<h1>Plain</h1>");
  });
});
