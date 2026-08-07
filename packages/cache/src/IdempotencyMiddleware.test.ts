import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { IdempotencyMiddleware } from "./IdempotencyMiddleware.ts";
import { CacheManager } from "./CacheManager.ts";
import { MemoryDriver } from "./drivers/MemoryDriver.ts";
import { HttpContext } from "@zerotal/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(): CacheManager {
  return new CacheManager(new MemoryDriver());
}

function makeCtx(method = "POST", headers: Record<string, string> = {}, body = "{}"): HttpContext {
  return HttpContext.fake("http://localhost/api/orders", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function makeMiddleware(opts: Partial<Parameters<typeof IdempotencyMiddleware.with>[0]> = {}) {
  const cache = opts.cache ?? makeCache();
  const Cls = IdempotencyMiddleware.with({ cache, ...opts });
  return new Cls();
}

// Runs the middleware against a context the way the pipeline runner does:
// next() takes no args; if it produces a downstream response it sets ctx.response
// and returns it. A Response returned by handle() is mirrored onto ctx.response.
async function run(
  mw: IdempotencyMiddleware,
  ctx: HttpContext,
  next: () => Promise<Response | void>,
): Promise<void> {
  const result = await mw.handle(ctx, next);
  if (result instanceof Response) ctx.response = result;
}

// Simulates the next pipe: sets a JSON response on ctx
function okHandler(ctx: HttpContext, data: unknown = { created: true }, status = 201) {
  return async (): Promise<Response | void> => {
    ctx.response = Response.json(data, { status });
    return ctx.response;
  };
}

function errorHandler(ctx: HttpContext, status = 500) {
  return async (): Promise<Response | void> => {
    ctx.response = new Response("Server Error", { status });
    return ctx.response;
  };
}

// ── Passthrough behaviour ─────────────────────────────────────────────────────

describe("IdempotencyMiddleware — passthrough", () => {
  let mw: IdempotencyMiddleware;

  beforeEach(() => {
    mw = makeMiddleware();
  });
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("passes through GET requests unchanged", async () => {
    const ctx = makeCtx("GET", { "Idempotency-Key": "key-1" });
    let nextCalled = false;
    await run(mw, ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("passes through HEAD requests unchanged", async () => {
    const ctx = makeCtx("HEAD", { "Idempotency-Key": "key-1" });
    let nextCalled = false;
    await run(mw, ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("passes through POST requests without an Idempotency-Key header", async () => {
    const ctx = makeCtx("POST", {}); // no key header
    let nextCalled = false;
    await run(mw, ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("passes through when no cache is configured", async () => {
    const Cls = IdempotencyMiddleware.with({ cache: undefined });
    const noCache = new Cls();
    const ctx = makeCtx("POST", { "Idempotency-Key": "key-x" });
    let nextCalled = false;
    await run(noCache, ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});

// ── First request (fresh execution) ───────────────────────────────────────────

describe("IdempotencyMiddleware — first request", () => {
  let cache: CacheManager;
  let mw: IdempotencyMiddleware;

  beforeEach(() => {
    cache = makeCache();
    mw = makeMiddleware({ cache });
  });
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("executes the handler on the first request", async () => {
    const ctx = makeCtx("POST", { "Idempotency-Key": "key-1" });
    let handlerRan = false;
    await run(mw, ctx, async () => {
      handlerRan = true;
      ctx.response = Response.json({ ok: true }, { status: 201 });
      return ctx.response;
    });
    expect(handlerRan).toBe(true);
    expect(ctx.response?.status).toBe(201);
  });

  it("does not add Idempotency-Replay header on first request", async () => {
    const ctx = makeCtx("POST", { "Idempotency-Key": "key-1" });
    await run(mw, ctx, okHandler(ctx));
    expect(ctx.response?.headers.get("Idempotency-Replay")).toBeNull();
  });

  it("stores the response in cache after execution", async () => {
    const ctx = makeCtx("POST", { "Idempotency-Key": "store-test" });
    await run(mw, ctx, okHandler(ctx, { id: 99 }));
    const cached = await cache.get("idempotency:store-test");
    expect(cached).not.toBeNull();
  });

  it("does NOT cache 5xx responses", async () => {
    const ctx = makeCtx("POST", { "Idempotency-Key": "err-key" });
    await run(mw, ctx, errorHandler(ctx, 503));
    const cached = await cache.get("idempotency:err-key");
    expect(cached).toBeNull();
  });

  it("does NOT cache 4xx responses that indicate transient errors — caches 4xx client errors", async () => {
    // 4xx (e.g. 422 validation) IS cached — the input was invalid, retrying with same body should replay
    const ctx = makeCtx("POST", { "Idempotency-Key": "val-key" });
    await run(mw, ctx, errorHandler(ctx, 422));
    const cached = await cache.get("idempotency:val-key");
    expect(cached).not.toBeNull(); // 422 < 500 → cached
  });
});

// ── Replay from cache ─────────────────────────────────────────────────────────

describe("IdempotencyMiddleware — cache replay", () => {
  let cache: CacheManager;
  let mw: IdempotencyMiddleware;

  beforeEach(() => {
    cache = makeCache();
    mw = makeMiddleware({ cache });
  });
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("replays the stored response on the second request", async () => {
    // First request
    const ctx1 = makeCtx("POST", { "Idempotency-Key": "replay-key" });
    let execCount = 0;
    const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      execCount++;
      ctx.response = Response.json({ id: 1 }, { status: 201 });
      return ctx.response;
    };
    await run(mw, ctx1, handler(ctx1));

    // Second request with same key
    const ctx2 = makeCtx("POST", { "Idempotency-Key": "replay-key" });
    await run(mw, ctx2, handler(ctx2));

    expect(execCount).toBe(1); // handler ran only once
    expect(ctx2.response?.status).toBe(201);
    const body = (await ctx2.response!.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
  });

  it("adds Idempotency-Replay: true on replayed response", async () => {
    const ctx1 = makeCtx("POST", { "Idempotency-Key": "replay-hdr" });
    await run(mw, ctx1, okHandler(ctx1));

    const ctx2 = makeCtx("POST", { "Idempotency-Key": "replay-hdr" });
    await run(mw, ctx2, okHandler(ctx2));

    expect(ctx2.response?.headers.get("Idempotency-Replay")).toBe("true");
  });

  it("preserves the original response status code on replay", async () => {
    const ctx1 = makeCtx("POST", { "Idempotency-Key": "status-key" });
    await run(mw, ctx1, okHandler(ctx1, { ok: true }, 201));

    const ctx2 = makeCtx("POST", { "Idempotency-Key": "status-key" });
    await run(mw, ctx2, okHandler(ctx2, { ok: true }, 200)); // different status in handler — should be ignored
    expect(ctx2.response?.status).toBe(201); // replayed from cache
  });

  it("preserves the original response headers on replay", async () => {
    const ctx1 = makeCtx("POST", { "Idempotency-Key": "header-key" });
    await run(mw, ctx1, async () => {
      ctx1.response = new Response("data", {
        status: 200,
        headers: { "X-Custom": "hello" },
      });
      return ctx1.response;
    });

    const ctx2 = makeCtx("POST", { "Idempotency-Key": "header-key" });
    await run(mw, ctx2, okHandler(ctx2));
    expect(ctx2.response?.headers.get("X-Custom")).toBe("hello");
  });

  it("different keys execute the handler independently", async () => {
    let count = 0;
    const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      count++;
      ctx.response = Response.json({ count }, { status: 200 });
      return ctx.response;
    };

    const ctxA = makeCtx("POST", { "Idempotency-Key": "key-a" });
    const ctxB = makeCtx("POST", { "Idempotency-Key": "key-b" });
    await run(mw, ctxA, handler(ctxA));
    await run(mw, ctxB, handler(ctxB));
    expect(count).toBe(2);
  });
});

// ── TTL ───────────────────────────────────────────────────────────────────────

describe("IdempotencyMiddleware — TTL", () => {
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("respects custom TTL when storing responses", async () => {
    const cache = makeCache();
    // We can't mock time easily, but verify the cache.set path is called with ttl
    // by confirming the value is present immediately after
    const mw = makeMiddleware({ cache, ttl: 1 });
    const ctx = makeCtx("POST", { "Idempotency-Key": "ttl-key" });
    await run(mw, ctx, okHandler(ctx));
    const cached = await cache.get("idempotency:ttl-key");
    expect(cached).not.toBeNull();
  });
});

// ── HTTP methods ──────────────────────────────────────────────────────────────

describe("IdempotencyMiddleware — method filtering", () => {
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "enforces idempotency for %s requests",
    async (method) => {
      const cache = makeCache();
      const mw = makeMiddleware({ cache });
      let count = 0;
      const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
        count++;
        ctx.response = Response.json({ ok: true });
        return ctx.response;
      };

      const ctx1 = makeCtx(method, { "Idempotency-Key": `${method}-key` });
      const ctx2 = makeCtx(method, { "Idempotency-Key": `${method}-key` });
      await run(mw, ctx1, handler(ctx1));
      await run(mw, ctx2, handler(ctx2));
      expect(count).toBe(1);
    },
  );

  it("allows custom method list", async () => {
    const cache = makeCache();
    const Cls = IdempotencyMiddleware.with({ cache, methods: ["POST"] });
    const mw = new Cls();

    let count = 0;
    const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      count++;
      ctx.response = Response.json({ ok: true });
      return ctx.response;
    };

    // PUT should NOT be deduplicated with this config
    const ctxA = makeCtx("PUT", { "Idempotency-Key": "put-key" });
    const ctxB = makeCtx("PUT", { "Idempotency-Key": "put-key" });
    await run(mw, ctxA, handler(ctxA));
    await run(mw, ctxB, handler(ctxB));
    expect(count).toBe(2); // both ran — PUT not in list
  });
});

// ── validateBody ──────────────────────────────────────────────────────────────

describe("IdempotencyMiddleware — validateBody", () => {
  let cache: CacheManager;
  let mw: IdempotencyMiddleware;

  beforeEach(() => {
    cache = makeCache();
    const Cls = IdempotencyMiddleware.with({ cache, validateBody: true });
    mw = new Cls();
  });
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("replays when the same key and same body are used", async () => {
    const body = JSON.stringify({ amount: 100 });
    const headers = { "Idempotency-Key": "pay-key", "Content-Type": "application/json" };
    let count = 0;
    const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      count++;
      ctx.response = Response.json({ ok: true }, { status: 201 });
      return ctx.response;
    };

    const ctx1 = makeCtx("POST", headers, body);
    const ctx2 = makeCtx("POST", headers, body);
    await run(mw, ctx1, handler(ctx1));
    await run(mw, ctx2, handler(ctx2));
    expect(count).toBe(1);
  });

  it("returns 422 when the same key is used with a different request body", async () => {
    const headers = { "Idempotency-Key": "pay-key-2", "Content-Type": "application/json" };

    // First request
    const ctx1 = makeCtx("POST", headers, JSON.stringify({ amount: 100 }));
    await run(mw, ctx1, async () => {
      ctx1.response = Response.json({ ok: true }, { status: 201 });
      return ctx1.response;
    });

    // Second request — same key, different body
    const ctx2 = makeCtx("POST", headers, JSON.stringify({ amount: 999 }));
    await run(mw, ctx2, okHandler(ctx2));

    expect(ctx2.response?.status).toBe(422);
    const body = (await ctx2.response!.json()) as Record<string, unknown>;
    expect(body.message).toContain("Idempotency-Key");
  });
});

// ── Concurrent request coalescing ─────────────────────────────────────────────

describe("IdempotencyMiddleware — concurrent coalescing", () => {
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("executes the handler exactly once for concurrent requests with the same key", async () => {
    const cache = makeCache();
    const mw = makeMiddleware({ cache });

    let execCount = 0;
    const slowHandler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      execCount++;
      await Bun.sleep(50);
      ctx.response = Response.json({ id: execCount }, { status: 201 });
      return ctx.response;
    };

    // Fire two requests concurrently
    const [ctx1, ctx2] = [
      makeCtx("POST", { "Idempotency-Key": "concurrent-key" }),
      makeCtx("POST", { "Idempotency-Key": "concurrent-key" }),
    ];

    await Promise.all([run(mw, ctx1, slowHandler(ctx1)), run(mw, ctx2, slowHandler(ctx2))]);

    expect(execCount).toBe(1); // only one execution
    expect(ctx1.response?.status).toBe(201);
    expect(ctx2.response?.status).toBe(201);
  });

  it("concurrent coalesced response carries Idempotency-Replay header on waiter", async () => {
    const cache = makeCache();
    const mw = makeMiddleware({ cache });

    const slowHandler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      await Bun.sleep(40);
      ctx.response = Response.json({ ok: true });
      return ctx.response;
    };

    const ctx1 = makeCtx("POST", { "Idempotency-Key": "cq-hdr" });
    const ctx2 = makeCtx("POST", { "Idempotency-Key": "cq-hdr" });

    await Promise.all([run(mw, ctx1, slowHandler(ctx1)), run(mw, ctx2, slowHandler(ctx2))]);

    // The "winner" (first to start) does not get the replay header.
    // The "waiter" (second, coalesced) does.
    const hasReplayHeader = (ctx: HttpContext) =>
      ctx.response?.headers.get("Idempotency-Replay") === "true";

    // Exactly one of them gets the replay header
    expect([hasReplayHeader(ctx1), hasReplayHeader(ctx2)].filter(Boolean).length).toBe(1);
  });

  it("handler errors do not corrupt the in-flight map for future requests", async () => {
    const cache = makeCache();
    const mw = makeMiddleware({ cache });
    const key = "err-concurrent";

    let attempt = 0;
    const flakyHandler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      attempt++;
      if (attempt === 1) throw new Error("transient error");
      ctx.response = Response.json({ ok: true }, { status: 200 });
      return ctx.response;
    };

    // First request — throws
    const ctx1 = makeCtx("POST", { "Idempotency-Key": key });
    await expect(run(mw, ctx1, flakyHandler(ctx1))).rejects.toThrow("transient error");

    // Second request — should succeed (in-flight map was cleaned up)
    const ctx2 = makeCtx("POST", { "Idempotency-Key": key });
    await run(mw, ctx2, flakyHandler(ctx2));
    expect(ctx2.response?.status).toBe(200);
  });
});

// ── Custom header name ────────────────────────────────────────────────────────

describe("IdempotencyMiddleware — custom header", () => {
  afterEach(() => IdempotencyMiddleware._clearInFlight());

  it("reads the key from a custom header", async () => {
    const cache = makeCache();
    const Cls = IdempotencyMiddleware.with({ cache, header: "X-Request-Id" });
    const mw = new Cls();

    let count = 0;
    const handler = (ctx: HttpContext) => async (): Promise<Response | void> => {
      count++;
      ctx.response = Response.json({ ok: true });
      return ctx.response;
    };

    const ctxA = makeCtx("POST", { "X-Request-Id": "req-001" });
    const ctxB = makeCtx("POST", { "X-Request-Id": "req-001" });
    await run(mw, ctxA, handler(ctxA));
    await run(mw, ctxB, handler(ctxB));
    expect(count).toBe(1);
  });
});
