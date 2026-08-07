import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import { CookieDriver } from "./drivers/CookieDriver.ts";
import { SessionManager } from "./SessionManager.ts";
import { CsrfMiddleware } from "./CsrfMiddleware.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const driver = new CookieDriver("test-secret", "session");

function makeCtx(method = "GET", csrfHeader?: string, existingToken?: string): HttpContext {
  const headers: Record<string, string> = {};
  if (csrfHeader) headers["x-csrf-token"] = csrfHeader;

  const req = new Request("http://localhost/test", { method, headers });
  const ctx = new HttpContext(req, null as never);

  const data: Record<string, unknown> = {};
  if (existingToken) data["_csrf_token"] = existingToken;

  const session = new SessionManager("test-session-id", data, driver);
  (ctx as unknown as Record<string, unknown>)["session"] = session;

  return ctx;
}

// Runs the middleware the way the pipeline runner does: next() takes no args,
// and a Response returned from handle() is mirrored onto ctx.response.
async function run(
  mw: CsrfMiddleware,
  ctx: HttpContext,
  next: () => Promise<Response | void> = async () => undefined,
): Promise<HttpContext> {
  const result = await mw.handle(ctx as never, next);
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

// ── CsrfMiddleware ────────────────────────────────────────────────────────────

describe("CsrfMiddleware", () => {
  it("passes GET requests through without checking token", async () => {
    const ctx = makeCtx("GET");
    const mw = new CsrfMiddleware();
    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("passes HEAD requests through without checking token", async () => {
    const ctx = makeCtx("HEAD");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("passes OPTIONS requests through without checking token", async () => {
    const ctx = makeCtx("OPTIONS");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("generates a CSRF token and stores it in the session on first GET", async () => {
    const ctx = makeCtx("GET");
    await run(new CsrfMiddleware(), ctx);
    const token = CsrfMiddleware.token(ctx);
    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(0);
  });

  it("POST with matching token passes through", async () => {
    const token = "valid-token-abc123";
    const ctx = makeCtx("POST", token, token);
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("POST without x-csrf-token header returns 419", async () => {
    const ctx = makeCtx("POST", undefined, "some-token");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
  });

  it("POST with wrong token returns 419", async () => {
    const ctx = makeCtx("POST", "wrong-token", "correct-token");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
  });

  it("PUT with correct token passes through", async () => {
    const token = "put-token";
    const ctx = makeCtx("PUT", token, token);
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("DELETE with correct token passes through", async () => {
    const token = "delete-token";
    const ctx = makeCtx("DELETE", token, token);
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("PATCH without token returns 419", async () => {
    const ctx = makeCtx("PATCH", undefined, "some-token");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
  });

  it("accepts x-xsrf-token header as alternative to x-csrf-token", async () => {
    const token = "xsrf-token-value";
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "x-xsrf-token": token },
    });
    const ctx = new HttpContext(req, null as never);
    const session = new SessionManager("id", { _csrf_token: token }, driver);
    (ctx as unknown as Record<string, unknown>)["session"] = session;

    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("token() returns the session CSRF token", () => {
    const ctx = makeCtx("GET", undefined, "my-token");
    expect(CsrfMiddleware.token(ctx)).toBe("my-token");
  });

  it("token() returns undefined when no session token is set", () => {
    const req = new Request("http://localhost/test");
    const ctx = new HttpContext(req, null as never);
    expect(CsrfMiddleware.token(ctx)).toBeUndefined();
  });

  it("sets XSRF-TOKEN cookie on successful GET response", async () => {
    const ctx = makeCtx("GET");
    await run(new CsrfMiddleware(), ctx, async () => {
      ctx.response = new Response("ok");
      return ctx.response;
    });
    const setCookie = ctx.response?.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("XSRF-TOKEN=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("HttpOnly");
  });

  it("does NOT set XSRF-TOKEN cookie on 419 response", async () => {
    const ctx = makeCtx("POST", "wrong", "correct");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
    // No XSRF-TOKEN cookie on failure — next() was never called
    const setCookie = ctx.response?.headers.get("Set-Cookie") ?? "";
    expect(setCookie).not.toContain("XSRF-TOKEN=");
  });
});
