import { describe, it, expect, beforeEach } from "bun:test";
import { ThrottleMiddleware } from "./ThrottleMiddleware.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(ip = "1.2.3.4", headers: Record<string, string> = {}): HttpContext {
  const reqHeaders = new Headers({ "x-forwarded-for": ip, ...headers });
  const request = new Request("http://localhost/test", { headers: reqHeaders });
  const container = new ScopedResolver();
  return new HttpContext(request, container);
}

async function run(
  middleware: ThrottleMiddleware,
  ctx: HttpContext,
  handler: (c: HttpContext) => void = (c) => {
    c.response = new Response("ok");
  },
): Promise<HttpContext> {
  const result = await middleware.handle(ctx, async () => {
    handler(ctx);
    return ctx.response;
  });
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ThrottleMiddleware", () => {
  let throttle: ThrottleMiddleware;

  beforeEach(() => {
    throttle = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60 });
    // Hit counters live on the class, not the instance (they must survive the pipeline
    // rebuilding middleware per request), so a fresh `new` no longer implies a fresh bucket.
    throttle.reset();
  });

  it("allows requests under the limit", async () => {
    const ctx = makeCtx();
    await run(throttle, ctx);
    expect(ctx.response?.status).toBe(200);
  });

  it("sets X-RateLimit-Limit header on allowed requests", async () => {
    const ctx = makeCtx();
    await run(throttle, ctx);
    expect(ctx.response?.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("sets X-RateLimit-Remaining header correctly", async () => {
    const ctx1 = makeCtx();
    await run(throttle, ctx1);
    expect(ctx1.response?.headers.get("X-RateLimit-Remaining")).toBe("2");

    const ctx2 = makeCtx();
    await run(throttle, ctx2);
    expect(ctx2.response?.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  it("returns 429 when limit is exceeded", async () => {
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await run(throttle, makeCtx());
    }
    const ctx = makeCtx();
    await run(throttle, ctx);
    expect(ctx.response?.status).toBe(429);
  });

  it("429 response has Retry-After header", async () => {
    for (let i = 0; i < 3; i++) await run(throttle, makeCtx());
    const ctx = makeCtx();
    await run(throttle, ctx);
    const retryAfter = ctx.response?.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("429 response is HTML for web requests", async () => {
    for (let i = 0; i < 3; i++) await run(throttle, makeCtx());
    const ctx = makeCtx();
    await run(throttle, ctx);
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
    const body = await ctx.response!.text();
    expect(body).toContain("Too Many Requests");
  });

  it("429 response is JSON for API requests", async () => {
    const t = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60 });
    for (let i = 0; i < 3; i++) {
      await run(t, makeCtx("1.2.3.4", { Accept: "application/json" }));
    }
    const ctx = makeCtx("1.2.3.4", { Accept: "application/json" });
    await run(t, ctx);
    expect(ctx.response?.status).toBe(429);
    const body = (await ctx.response!.json()) as Record<string, unknown>;
    expect(body.message).toBe("Too Many Requests");
  });

  it("429 response is plain text for CLI requests", async () => {
    const t = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60 });
    for (let i = 0; i < 3; i++) {
      await run(t, makeCtx("1.2.3.4", { "X-Zerotal-Channel": "cli" }));
    }
    const ctx = makeCtx("1.2.3.4", { "X-Zerotal-Channel": "cli" });
    await run(t, ctx);
    expect(ctx.response?.status).toBe(429);
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/plain");
    const body = await ctx.response!.text();
    expect(body).toContain("Rate limit exceeded");
  });

  it("tracks different IPs independently", async () => {
    // makeCtx() spoofs the client address via X-Forwarded-For, so this must declare a trusted
    // proxy hop — the header is ignored by default.
    const t = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60, trustedProxies: 1 });
    t.reset();

    // Exhaust limit for IP1
    for (let i = 0; i < 3; i++) await run(t, makeCtx("1.2.3.4"));

    // IP2 should still be allowed
    const ctx = makeCtx("9.9.9.9");
    await run(t, ctx);
    expect(ctx.response?.status).toBe(200);
  });

  it("ignores X-Forwarded-For by default, so the header cannot be used to evade the limit", async () => {
    // Regression guard. `trustedProxies` defaults to undefined, and the header used to be
    // consulted *before* the unspoofable socket address — so a client on a direct connection
    // could mint a fresh bucket per request just by rotating the header, defeating every
    // limiter built on this middleware including the documented login throttle.
    const t = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60 });
    t.reset();

    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const ctx = makeCtx(`1.2.3.${i}`); // a different forged X-Forwarded-For every time
      await run(t, ctx);
      statuses.push(ctx.response?.status);
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it("still honours X-Forwarded-For when a trusted proxy count is configured", async () => {
    const t = new ThrottleMiddleware({ maxAttempts: 3, windowSeconds: 60, trustedProxies: 1 });
    t.reset();

    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const ctx = makeCtx(`1.2.3.${i}`);
      await run(t, ctx);
      statuses.push(ctx.response?.status);
    }

    // Each forwarded address is a distinct bucket, so nothing is throttled.
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("reset() clears counters", async () => {
    for (let i = 0; i < 3; i++) await run(throttle, makeCtx());
    throttle.reset();

    const ctx = makeCtx();
    await run(throttle, ctx);
    expect(ctx.response?.status).toBe(200);
  });

  it("uses x-real-ip when x-forwarded-for is absent", async () => {
    const t = new ThrottleMiddleware({ maxAttempts: 1, windowSeconds: 60 });

    // First request via x-real-ip
    const request1 = new Request("http://localhost/", { headers: { "x-real-ip": "5.5.5.5" } });
    const container = new ScopedResolver();
    const ctx1 = new HttpContext(request1, container);
    await run(t, ctx1);
    expect(ctx1.response?.status).toBe(200);

    // Second request — same IP, should be throttled
    const request2 = new Request("http://localhost/", { headers: { "x-real-ip": "5.5.5.5" } });
    const ctx2 = new HttpContext(request2, new ScopedResolver());
    await run(t, ctx2);
    expect(ctx2.response?.status).toBe(429);
  });

  it("supports a custom keyResolver", async () => {
    const t = new ThrottleMiddleware({
      maxAttempts: 1,
      windowSeconds: 60,
      keyResolver: (ctx) => ctx.request.headers.get("x-api-key") ?? "anon",
    });

    const ctx1 = makeCtx("1.2.3.4", { "x-api-key": "key-a" });
    await run(t, ctx1);
    expect(ctx1.response?.status).toBe(200);

    // Second request with same API key — throttled
    const ctx2 = makeCtx("1.2.3.4", { "x-api-key": "key-a" });
    await run(t, ctx2);
    expect(ctx2.response?.status).toBe(429);

    // Different API key — not throttled
    const ctx3 = makeCtx("1.2.3.4", { "x-api-key": "key-b" });
    await run(t, ctx3);
    expect(ctx3.response?.status).toBe(200);
  });

  it("does not attach rate-limit headers when handler sets no response", async () => {
    const ctx = makeCtx();
    await run(throttle, ctx, () => {
      /* no response set */
    });
    // No response was set by the handler — no headers to check
    expect(ctx.response).toBeUndefined();
  });
});
