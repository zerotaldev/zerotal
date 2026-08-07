import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { Router } from "./Router.ts";
import type { Container } from "../container/Container.ts";

const fakeContainer = {} as unknown as Container;
const TMP = `./.tmp-static-${Date.now()}`;

beforeEach(() => {
  Router.reset();
});

afterAll(async () => {
  // Use node:fs rm (not Bun.$`rm -rf`, which silently no-ops on Windows and
  // leaves .tmp-static-* dirs behind) so the temp tree is reliably removed.
  await rm(TMP, { recursive: true, force: true });
});

describe("Router.static() — eager pre-registration", () => {
  it("registers each file as a static Response at compile time", async () => {
    await Bun.write(`${TMP}/app.css`, "body{}");
    await Bun.write(`${TMP}/js/app.js`, "console.log(1)");
    Router.static("/assets", TMP);
    const compiled = Router.compile(fakeContainer);
    expect(compiled["/assets/app.css"]).toBeInstanceOf(Response);
    expect(compiled["/assets/js/app.js"]).toBeInstanceOf(Response);
  });

  it("applies custom headers to served files", async () => {
    await Bun.write(`${TMP}/app.css`, "body{}");
    Router.static("/assets", TMP, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
    const compiled = Router.compile(fakeContainer);
    const res = compiled["/assets/app.css"] as Response;
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not pre-register when eager is false", async () => {
    await Bun.write(`${TMP}/app.css`, "body{}");
    Router.static("/assets", TMP, { eager: false });
    const compiled = Router.compile(fakeContainer);
    expect(compiled["/assets/app.css"]).toBeUndefined();
  });

  it("never shadows an explicit route at the same path", async () => {
    await Bun.write(`${TMP}/ping`, "static");
    Router.get(
      "/assets/ping",
      class {
        handle() {}
      } as never,
      "handle",
    );
    Router.static("/assets", TMP);
    const compiled = Router.compile(fakeContainer);
    expect(compiled["/assets/ping"]).not.toBeInstanceOf(Response);
  });
});

describe("Router.controllers() — auto-registration", () => {
  it("invokes each controller class static register() hook", async () => {
    const count = await Router.controllers(`${import.meta.dir}/__fixtures__`);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(Router.routes.has("GET /health-fixture")).toBe(true);
  });

  it("returns 0 for a missing directory", async () => {
    const count = await Router.controllers(`${import.meta.dir}/__missing__`);
    expect(count).toBe(0);
  });
});
