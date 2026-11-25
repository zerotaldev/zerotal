import { describe, it, expect } from "bun:test";
import { SecureHeadersMiddleware } from "./SecureHeadersMiddleware.ts";
import type { SecureHeadersOptions } from "./SecureHeadersMiddleware.ts";
import type { DeepPartial } from "../support/deepMerge.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

function makeCtx(): HttpContext {
  return new HttpContext(new Request("http://localhost/"), new ScopedResolver());
}

async function run(
  MwClass: new () => SecureHeadersMiddleware,
  ctx: HttpContext,
): Promise<HttpContext> {
  const mw = new MwClass();
  const result = await mw.handle(ctx, async () => {
    ctx.response = new Response("ok");
    return ctx.response;
  });
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

// Shorthand: instantiate with options via .with() then run.
// Named directly rather than derived from `with` — it is a method, not a
// constructor, so `ConstructorParameters` never described it.
async function runWith(
  opts: DeepPartial<SecureHeadersOptions>,
  ctx = makeCtx(),
): Promise<HttpContext> {
  return run(SecureHeadersMiddleware.with(opts), ctx);
}

// ── Defaults ──────────────────────────────────────────────────────────────────

describe("SecureHeadersMiddleware — defaults", () => {
  it("adds X-Content-Type-Options: nosniff", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    expect(ctx.response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("adds X-Frame-Options: SAMEORIGIN by default", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    expect(ctx.response?.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("adds Referrer-Policy: strict-origin-when-cross-origin by default", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    expect(ctx.response?.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("adds Permissions-Policy with conservative defaults", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    const pp = ctx.response?.headers.get("Permissions-Policy") ?? "";
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
  });

  it("does NOT add Strict-Transport-Security by default (HTTP dev mode)", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    expect(ctx.response?.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does NOT add Content-Security-Policy by default", async () => {
    const ctx = await run(SecureHeadersMiddleware, makeCtx());
    expect(ctx.response?.headers.get("Content-Security-Policy")).toBeNull();
  });
});

// ── frameOptions option ───────────────────────────────────────────────────────

describe("SecureHeadersMiddleware — frameOptions", () => {
  it('frameOptions: "DENY" sets X-Frame-Options to DENY', async () => {
    const ctx = await runWith({ frameOptions: "DENY" });
    expect(ctx.response?.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("frameOptions: false omits X-Frame-Options entirely", async () => {
    const ctx = await runWith({ frameOptions: false });
    expect(ctx.response?.headers.get("X-Frame-Options")).toBeNull();
  });
});

// ── HSTS (secure mode) ────────────────────────────────────────────────────────

describe("SecureHeadersMiddleware — HSTS (secure: true)", () => {
  it("adds Strict-Transport-Security with default max-age", async () => {
    const ctx = await runWith({ secure: true });
    const hsts = ctx.response?.headers.get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
  });

  it("hstsMaxAge: 0 suppresses the HSTS header", async () => {
    const ctx = await runWith({ secure: true, hstsMaxAge: 0 });
    expect(ctx.response?.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("hstsIncludeSubDomains: false omits includeSubDomains", async () => {
    const ctx = await runWith({ secure: true, hstsIncludeSubDomains: false });
    const hsts = ctx.response?.headers.get("Strict-Transport-Security") ?? "";
    expect(hsts).not.toContain("includeSubDomains");
  });

  it("hstsPreload: true adds the preload directive", async () => {
    const ctx = await runWith({ secure: true, hstsPreload: true });
    const hsts = ctx.response?.headers.get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("preload");
  });

  it("custom hstsMaxAge is respected", async () => {
    const ctx = await runWith({ secure: true, hstsMaxAge: 86_400 });
    expect(ctx.response?.headers.get("Strict-Transport-Security")).toContain("max-age=86400");
  });
});

// ── CSP ───────────────────────────────────────────────────────────────────────

describe("SecureHeadersMiddleware — contentSecurityPolicy", () => {
  it("sets Content-Security-Policy when provided", async () => {
    const ctx = await runWith({ contentSecurityPolicy: "default-src 'self'" });
    expect(ctx.response?.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
  });
});

// ── Referrer-Policy / Permissions-Policy ─────────────────────────────────────

describe("SecureHeadersMiddleware — custom referrerPolicy", () => {
  it("respects a custom referrerPolicy value", async () => {
    const ctx = await runWith({ referrerPolicy: "no-referrer" });
    expect(ctx.response?.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("SecureHeadersMiddleware — permissionsPolicy", () => {
  it("sets a custom Permissions-Policy when provided", async () => {
    const ctx = await runWith({ permissionsPolicy: "geolocation=()" });
    expect(ctx.response?.headers.get("Permissions-Policy")).toBe("geolocation=()");
  });

  it("permissionsPolicy: false omits the header", async () => {
    const ctx = await runWith({ permissionsPolicy: false });
    expect(ctx.response?.headers.get("Permissions-Policy")).toBeNull();
  });
});

// ── A header the response already has ─────────────────────────────────────────
//
// This middleware runs first in the pipeline, so whatever is inside it (the route, or the app's
// own middleware) has already answered. A header it set is the narrower policy for that one
// response; replacing it with the global default silently removed the control it existed for.

async function runOver(
  opts: DeepPartial<SecureHeadersOptions>,
  inner: Response,
): Promise<Response> {
  const mw = new (SecureHeadersMiddleware.with(opts))();
  const result = await mw.handle(makeCtx(), async () => inner);
  if (!(result instanceof Response)) throw new Error("expected a response");
  return result;
}

describe("SecureHeadersMiddleware — a header the route already set", () => {
  const sandboxed = "sandbox allow-scripts allow-modals";

  it("keeps the route's CSP over the global one", async () => {
    const res = await runOver(
      { contentSecurityPolicy: "default-src 'self'" },
      new Response("print view", { headers: { "Content-Security-Policy": sandboxed } }),
    );
    expect(res.headers.get("Content-Security-Policy")).toBe(sandboxed);
  });

  it("keeps the route's framing policy over the default", async () => {
    const res = await runOver(
      { frameOptions: "DENY", contentSecurityPolicy: "frame-ancestors 'none'" },
      new Response("preview", {
        headers: {
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "frame-ancestors 'self'",
        },
      }),
    );
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'self'");
  });

  it("still adds every header the route did not set", async () => {
    const res = await runOver(
      { secure: true, contentSecurityPolicy: "default-src 'self'" },
      new Response("ok", { headers: { "Content-Security-Policy": sandboxed } }),
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("matches the route's header in any case", async () => {
    const res = await runOver(
      { contentSecurityPolicy: "default-src 'self'" },
      new Response("ok", { headers: { "content-security-policy": sandboxed } }),
    );
    expect(res.headers.get("Content-Security-Policy")).toBe(sandboxed);
  });

  it("returns the route's response as it is when it already has every header", async () => {
    const inner = new Response("ok", {
      status: 201,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=()",
      },
    });
    expect(await runOver({}, inner)).toBe(inner);
  });

  it("keeps the status and body when it adds headers", async () => {
    const res = await runOver(
      {},
      new Response("created", { status: 201, headers: { "Content-Security-Policy": sandboxed } }),
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("created");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

// ── No response body (early return) ─────────────────────────────────────────

describe("SecureHeadersMiddleware — no response", () => {
  it("returns ctx unchanged when next() produces no response", async () => {
    const mw = new SecureHeadersMiddleware();
    const ctx = makeCtx();
    // next() does NOT set a response
    const result = await mw.handle(ctx, async () => undefined);
    if (result instanceof Response) ctx.response = result;
    expect(result).toBeUndefined();
    expect(ctx.response).toBeUndefined();
  });
});
