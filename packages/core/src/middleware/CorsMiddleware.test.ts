import { describe, it, expect } from "bun:test";
import { CorsMiddleware } from "./CorsMiddleware.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

function makeCtx(method = "GET", origin = "https://app.example.com"): HttpContext {
  const headers = new Headers({ Origin: origin });
  const req = new Request(`http://localhost/test`, { method, headers });
  return new HttpContext(req, new ScopedResolver());
}

async function run(mw: CorsMiddleware, ctx: HttpContext): Promise<HttpContext> {
  // Mirror the pipeline runner: next() returns the downstream response, and a
  // Response returned by handle() is written back onto the canonical ctx.response.
  const result = await mw.handle(ctx, async () => {
    ctx.response = new Response("ok");
    return ctx.response;
  });
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

describe("CorsMiddleware — defaults", () => {
  const mw = new CorsMiddleware();

  it("shares nothing until an app names an origin", async () => {
    // `origin: "*"` used to be the default, which handed every page on the internet a read
    // of any endpoint this middleware covered.
    const ctx = await run(mw, makeCtx("GET", "https://anywhere.example"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses to pair a wildcard with credentials", async () => {
    // Browsers reject `Allow-Origin: *` alongside `Allow-Credentials: true`, so an app
    // setting both is misconfigured. Reflecting the caller's origin would quietly turn
    // that into "any origin, with cookies".
    const wild = new CorsMiddleware({ origin: "*", credentials: true });
    const ctx = await run(wild, makeCtx("GET", "https://evil.example"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("CorsMiddleware — wildcard", () => {
  const mw = new CorsMiddleware({ origin: "*" });

  it("adds Access-Control-Allow-Origin: * to normal responses", async () => {
    const ctx = await run(mw, makeCtx());
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 204 for OPTIONS preflight", async () => {
    const ctx = await run(mw, makeCtx("OPTIONS"));
    expect(ctx.response?.status).toBe(204);
  });

  it("preflight includes Allow-Methods header", async () => {
    const ctx = await run(mw, makeCtx("OPTIONS"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("preflight includes Allow-Headers header", async () => {
    const ctx = await run(mw, makeCtx("OPTIONS"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("CorsMiddleware — specific origin", () => {
  const mw = new CorsMiddleware({ origin: "https://app.example.com", credentials: true });

  it("echoes the matched origin back", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://app.example.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com",
    );
  });

  it("adds credentials header when enabled", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://app.example.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does NOT add CORS headers for unmatched origin", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://evil.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("CorsMiddleware — array of origins", () => {
  const mw = new CorsMiddleware({ origin: ["https://a.com", "https://b.com"] });

  it("allows listed origin", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://a.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBe("https://a.com");
  });

  it("blocks unlisted origin", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://c.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("CorsMiddleware — function origin", () => {
  const mw = new CorsMiddleware({ origin: (o) => o.endsWith(".example.com") });

  it("allows matching origin", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://sub.example.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://sub.example.com",
    );
  });

  it("blocks non-matching origin", async () => {
    const ctx = await run(mw, makeCtx("GET", "https://evil.com"));
    expect(ctx.response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("CorsMiddleware — exposed headers", () => {
  const mw = new CorsMiddleware({
    origin: "*",
    exposedHeaders: ["X-Total-Count", "X-Page"],
  });

  it("includes exposed headers in response", async () => {
    const ctx = await run(mw, makeCtx());
    expect(ctx.response?.headers.get("Access-Control-Expose-Headers")).toContain("X-Total-Count");
  });
});
