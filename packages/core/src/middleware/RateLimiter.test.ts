import { describe, it, expect, afterEach } from "bun:test";
import { RateLimiter } from "./RateLimiter.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

function makeCtx(ip = "10.0.0.1"): HttpContext {
  const req = new Request("http://localhost/", {
    headers: { "x-forwarded-for": ip },
  });
  return new HttpContext(req, new ScopedResolver());
}

// Drives a middleware the way the pipeline runner does: next() sets a downstream
// response and returns it, and a Response returned by handle() is mirrored onto
// the canonical ctx.response.
async function runMw(
  mw: InstanceType<ReturnType<typeof RateLimiter.middleware>>,
  ctx: HttpContext,
): Promise<HttpContext> {
  const result = await mw.handle(ctx, async () => {
    ctx.response = new Response("ok");
    return ctx.response;
  });
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

afterEach(() => RateLimiter.clear());

describe("RateLimiter.for().register()", () => {
  it("registers a named limiter", () => {
    RateLimiter.for("test").limit(10).every(60).register();
    expect(() => RateLimiter.middleware("test")).not.toThrow();
  });

  it("throws when accessing an unregistered limiter", () => {
    expect(() => RateLimiter.middleware("unknown")).toThrow("unknown");
  });

  it("middleware() returns a ThrottleMiddleware", () => {
    RateLimiter.for("api").limit(5).every(30).register();
    const mw = new (RateLimiter.middleware("api"))();
    expect(typeof mw.handle).toBe("function");
  });
});

describe("RateLimiter.middleware() throttling", () => {
  it("allows requests under the limit", async () => {
    RateLimiter.for("limited").limit(3).every(60).register();
    const mw = new (RateLimiter.middleware("limited"))();
    const ctx = makeCtx();
    await runMw(mw, ctx);
    expect(ctx.response?.status).toBe(200);
  });

  it("throttles after limit is exceeded", async () => {
    RateLimiter.for("tight").limit(2).every(60).register();
    const mw = new (RateLimiter.middleware("tight"))();
    for (let i = 0; i < 2; i++) {
      const ctx = makeCtx("5.5.5.5");
      await runMw(mw, ctx);
    }
    const ctx = makeCtx("5.5.5.5");
    await runMw(mw, ctx);
    expect(ctx.response?.status).toBe(429);
  });
});

describe("LimiterDefinition.byUser()", () => {
  it("keys authenticated users by user:id", async () => {
    RateLimiter.for("u").limit(1).every(60).byUser().register();
    const mw = new (RateLimiter.middleware("u"))();

    const makeAuthedCtx = (id: number) => {
      const ctx = makeCtx("1.2.3.4");
      ctx.user = { id };
      return ctx;
    };

    const ctx1 = makeAuthedCtx(1);
    await runMw(mw, ctx1);
    expect(ctx1.response?.status).toBe(200);

    // Same user — throttled
    const ctx2 = makeAuthedCtx(1);
    await runMw(mw, ctx2);
    expect(ctx2.response?.status).toBe(429);

    // Different user — not throttled
    const ctx3 = makeAuthedCtx(2);
    await runMw(mw, ctx3);
    expect(ctx3.response?.status).toBe(200);
  });

  it("falls back to IP for unauthenticated requests", async () => {
    // `.trustedProxies(1)` is what makes X-Forwarded-For readable at all. Without
    // it the header is ignored and every one of these keys on the socket address,
    // which is the point of the guard rather than a limitation of the test.
    RateLimiter.for("u2").limit(1).every(60).byUser().trustedProxies(1).register();
    const mw = new (RateLimiter.middleware("u2"))();

    const run = async (ip: string) => {
      const ctx = makeCtx(ip);
      await runMw(mw, ctx);
      return ctx.response?.status;
    };

    expect(await run("9.9.9.1")).toBe(200);
    expect(await run("9.9.9.1")).toBe(429); // same IP throttled
    expect(await run("9.9.9.2")).toBe(200); // different IP not throttled
  });

  it("authenticated users are isolated from unauthenticated IP buckets", async () => {
    RateLimiter.for("u3").limit(1).every(60).byUser().register();
    const mw = new (RateLimiter.middleware("u3"))();

    // Exhaust the IP bucket for 7.7.7.7
    const anonCtx = makeCtx("7.7.7.7");
    await runMw(mw, anonCtx);
    await runMw(mw, anonCtx);
    expect(anonCtx.response?.status).toBe(429);

    // Authenticated user on same IP — separate bucket, not throttled
    const authedCtx = makeCtx("7.7.7.7");
    authedCtx.user = { id: 99 };
    await runMw(mw, authedCtx);
    expect(authedCtx.response?.status).toBe(200);
  });
});

describe("LimiterDefinition.byApiKey()", () => {
  const run = async (
    mw: InstanceType<ReturnType<typeof RateLimiter.middleware>>,
    headers: Record<string, string>,
  ) => {
    const req = new Request("http://localhost/", { headers });
    const ctx = new HttpContext(req, new ScopedResolver());
    await runMw(mw, ctx);
    return ctx.response?.status;
  };

  it("keys by api key header", async () => {
    RateLimiter.for("ak").limit(1).every(60).byApiKey().register();
    const mw = new (RateLimiter.middleware("ak"))();

    expect(await run(mw, { "x-api-key": "key-A" })).toBe(200);
    expect(await run(mw, { "x-api-key": "key-A" })).toBe(429);
    expect(await run(mw, { "x-api-key": "key-B" })).toBe(200); // different key
  });

  it("falls back to IP when no api key header is present", async () => {
    RateLimiter.for("ak2").limit(1).every(60).byApiKey().trustedProxies(1).register();
    const mw = new (RateLimiter.middleware("ak2"))();

    expect(await run(mw, { "x-forwarded-for": "3.3.3.3" })).toBe(200);
    expect(await run(mw, { "x-forwarded-for": "3.3.3.3" })).toBe(429);
  });

  it("supports a custom header name", async () => {
    RateLimiter.for("ak3").limit(1).every(60).byApiKey("authorization").register();
    const mw = new (RateLimiter.middleware("ak3"))();

    expect(await run(mw, { authorization: "Bearer secret-token" })).toBe(200);
    expect(await run(mw, { authorization: "Bearer secret-token" })).toBe(429);
    expect(await run(mw, { authorization: "Bearer other-token" })).toBe(200);
  });
});

describe("LimiterDefinition.byIp()", () => {
  it("keys by IP explicitly", async () => {
    RateLimiter.for("ip").limit(1).every(60).byIp().trustedProxies(1).register();
    const mw = new (RateLimiter.middleware("ip"))();

    const run = async (ip: string) => {
      const ctx = makeCtx(ip);
      await runMw(mw, ctx);
      return ctx.response?.status;
    };

    expect(await run("5.5.5.5")).toBe(200);
    expect(await run("5.5.5.5")).toBe(429);
    expect(await run("6.6.6.6")).toBe(200);
  });
});

describe("RateLimiter.resetFor()", () => {
  it("clears the counter for a specific IP so they can try again", async () => {
    RateLimiter.for("login").limit(2).every(60).register();
    const mw = new (RateLimiter.middleware("login"))();

    // Exhaust the limit for 1.2.3.4
    for (let i = 0; i < 2; i++) {
      const ctx = makeCtx("1.2.3.4");
      await runMw(mw, ctx);
    }
    const blocked = makeCtx("1.2.3.4");
    await runMw(mw, blocked);
    expect(blocked.response?.status).toBe(429);

    // Reset this IP's counter
    RateLimiter.resetFor("login", makeCtx("1.2.3.4"));

    // They can now make requests again
    const after = makeCtx("1.2.3.4");
    await runMw(mw, after);
    expect(after.response?.status).toBe(200);
  });

  it("does not affect other actors when one is reset", async () => {
    RateLimiter.for("reset2").limit(1).every(60).register();
    const mw = new (RateLimiter.middleware("reset2"))();

    const hit = async (ip: string) => {
      const ctx = makeCtx(ip);
      await runMw(mw, ctx);
      return ctx.response?.status;
    };

    await hit("2.0.0.1"); // exhaust 2.0.0.1
    await hit("2.0.0.2"); // exhaust 2.0.0.2

    RateLimiter.resetFor("reset2", makeCtx("2.0.0.1"));

    expect(await hit("2.0.0.1")).toBe(200); // reset — allowed
    expect(await hit("2.0.0.2")).toBe(429); // not reset — still blocked
  });

  it("throws when the limiter is not registered", () => {
    expect(() => RateLimiter.resetFor("nonexistent", makeCtx())).toThrow("nonexistent");
  });
});

describe("RateLimiter.for().by()", () => {
  it("uses custom key resolver", async () => {
    RateLimiter.for("byUser")
      .limit(1)
      .every(60)
      .by((ctx) => ctx.request.headers.get("x-user-id") ?? "anon")
      .register();

    const mw = new (RateLimiter.middleware("byUser"))();

    const ctx1 = makeCtx();
    ctx1.request.headers.set("x-user-id", "user-a");
    // Not going to work since headers are immutable on Request — test via different approach

    // Instead verify the custom key resolver is wired by exhausting user-a:
    const run = async (userId: string) => {
      const req = new Request("http://localhost/", { headers: { "x-user-id": userId } });
      const ctx = new HttpContext(req, new ScopedResolver());
      await runMw(mw, ctx);
      return ctx.response?.status;
    };

    expect(await run("user-a")).toBe(200); // first hit
    expect(await run("user-a")).toBe(429); // throttled
    expect(await run("user-b")).toBe(200); // different user — not throttled
  });
});

// ── RateLimiter.tooManyAttempts() ─────────────────────────────────────────────

describe("RateLimiter.tooManyAttempts()", () => {
  it("returns false when under the limit", async () => {
    RateLimiter.for("attempt").limit(3).every(60).register();
    const ctx = makeCtx("1.2.3.4");
    const throttled = await RateLimiter.tooManyAttempts("attempt", ctx);
    expect(throttled).toBe(false);
    // ctx.response should be reset to undefined after the check
    expect(ctx.response).toBeUndefined();
  });

  it("returns true once the limit is exceeded", async () => {
    RateLimiter.for("attempt2").limit(1).every(60).register();
    const ctx = makeCtx("1.2.3.5");
    // First call — under limit
    await RateLimiter.tooManyAttempts("attempt2", ctx);
    // Second call — over limit
    const throttled = await RateLimiter.tooManyAttempts("attempt2", ctx);
    expect(throttled).toBe(true);
    expect(ctx.response).toBeUndefined();
  });

  it("throws when the limiter is not registered", async () => {
    const ctx = makeCtx();
    await expect(RateLimiter.tooManyAttempts("ghost", ctx)).rejects.toThrow("ghost");
  });
});

/**
 * A named limiter has to obey `trustedProxies` like the middleware it builds on.
 *
 * `.byIp()`, `.byUser()` and `.byApiKey()` used a private resolver that read the
 * socket address and then fell back to the **leftmost** `X-Forwarded-For` entry with
 * no proxy count at all. Two consequences, both bad and in opposite directions:
 *
 * - Where there was no socket address, a client picked its own bucket by writing the
 *   header — the header is client-written, and the leftmost entry is the part the
 *   client controls.
 * - Behind a real reverse proxy, where there *is* a socket address, it was the
 *   proxy's. Every visitor shared one bucket, so a `login` limiter of five attempts a
 *   minute was five attempts a minute for the whole user base and one attacker locked
 *   everybody out.
 *
 * `ThrottleMiddleware` fixed exactly this and the sibling API kept it, because a
 * `keyResolver` replaces the middleware's own proxy-aware path entirely.
 */
describe("named limiters honour trustedProxies", () => {
  const withHeaders = async (
    mw: InstanceType<ReturnType<typeof RateLimiter.middleware>>,
    headers: Record<string, string>,
  ): Promise<number | undefined> => {
    const ctx = new HttpContext(
      new Request("http://localhost/", { headers }),
      new ScopedResolver(),
    );
    await runMw(mw, ctx);
    return ctx.response?.status;
  };

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    RateLimiter.for("tp-off").limit(1).every(60).byIp().register();
    const mw = new (RateLimiter.middleware("tp-off"))();

    // A rotating forged header must not buy a fresh bucket. Before the fix each of
    // these was a new key and the limiter never fired.
    expect(await withHeaders(mw, { "x-forwarded-for": "1.1.1.1" })).toBe(200);
    expect(await withHeaders(mw, { "x-forwarded-for": "2.2.2.2" })).toBe(429);
    expect(await withHeaders(mw, { "x-forwarded-for": "3.3.3.3" })).toBe(429);
  });

  it("reads the entry the trusted proxy appended, not the one the client wrote", async () => {
    RateLimiter.for("tp-on").limit(1).every(60).byIp().trustedProxies(1).register();
    const mw = new (RateLimiter.middleware("tp-on"))();

    // One proxy: the client's address is the second-from-right. The leftmost entry
    // is whatever the client sent, and must not decide the bucket.
    expect(await withHeaders(mw, { "x-forwarded-for": "9.9.9.9, 5.5.5.5, 10.0.0.1" })).toBe(200);
    expect(await withHeaders(mw, { "x-forwarded-for": "1.1.1.1, 5.5.5.5, 10.0.0.1" })).toBe(429);

    // A genuinely different client — different second-from-right — is its own bucket.
    expect(await withHeaders(mw, { "x-forwarded-for": "9.9.9.9, 6.6.6.6, 10.0.0.1" })).toBe(200);
  });

  it("applies the count however the builder was ordered", async () => {
    // `.trustedProxies()` after `.byIp()` has to reach the resolver `.byIp()` chose,
    // which is why the strategy is recorded and the resolver built at the end.
    RateLimiter.for("tp-order").limit(1).every(60).trustedProxies(1).byIp().register();
    const mw = new (RateLimiter.middleware("tp-order"))();

    expect(await withHeaders(mw, { "x-forwarded-for": "9.9.9.9, 5.5.5.5, 10.0.0.1" })).toBe(200);
    expect(await withHeaders(mw, { "x-forwarded-for": "1.1.1.1, 6.6.6.6, 10.0.0.1" })).toBe(200);
  });
});
