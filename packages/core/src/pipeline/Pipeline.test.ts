import { describe, it, expect } from "bun:test";
import { Pipeline } from "./Pipeline.ts";
import type { Pipe, NextFn } from "./types.ts";
import { HttpContext } from "./HttpContext.ts";

// ── Helpers ───────────────────────────────────────────────────────────────
//
// The pipeline carries the request HttpContext and the canonical Response lives
// on `ctx.response`. Each pipe either continues (`next()`), short-circuits (return
// a Response, or set ctx.response and return void), or wraps (await next(),
// transform the downstream Response). A shared `log` is stashed on the context
// so tests can assert execution order across the (zero-arg) pipe classes.

function makeCtx(): { payload: HttpContext; log: string[] } {
  const ctx = HttpContext.fake("http://localhost/");
  const log: string[] = [];
  (ctx as unknown as { log: string[] }).log = log;
  return { payload: ctx, log };
}

const logOf = (p: HttpContext): string[] => (p as unknown as { log: string[] }).log;

/** Continues the chain (wrap-style: records itself, then delegates to next). */
class TagA implements Pipe<HttpContext> {
  async handle(payload: HttpContext, next: NextFn): Promise<Response | void> {
    logOf(payload).push("A");
    return next();
  }
}

class TagB implements Pipe<HttpContext> {
  async handle(payload: HttpContext, next: NextFn): Promise<Response | void> {
    logOf(payload).push("B");
    return next();
  }
}

/** Innermost controller-like pipe: produces the response. */
class Responder implements Pipe<HttpContext> {
  async handle(payload: HttpContext, _next: NextFn): Promise<Response | void> {
    logOf(payload).push("Responder");
    payload.response = new Response("ok", { status: 200 });
    return payload.response;
  }
}

/** Short-circuits by RETURNING a Response (never calls next). */
class ReturnGuard implements Pipe<HttpContext> {
  async handle(payload: HttpContext, _next: NextFn): Promise<Response | void> {
    logOf(payload).push("ReturnGuard");
    return new Response("blocked", { status: 403 });
  }
}

/** Short-circuits by setting ctx.response and returning void (never calls next). */
class VoidGuard implements Pipe<HttpContext> {
  async handle(payload: HttpContext, _next: NextFn): Promise<Response | void> {
    logOf(payload).push("VoidGuard");
    payload.response = new Response("unauth", { status: 401 });
    // does NOT call next() and does NOT return the Response
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Pipeline — basic execution", () => {
  it("runs pipes in order, surfacing the response on ctx.response", async () => {
    const { payload, log } = makeCtx();

    const result = await Pipeline.send(payload).through([TagA, TagB, Responder]).thenReturn();

    expect(result.response?.status).toBe(200);
    expect(log).toEqual(["A", "B", "Responder"]);
  });

  it("passes payload to destination via then()", async () => {
    const { payload } = makeCtx();

    const status = await Pipeline.send(payload)
      .through([Responder])
      .then((p) => p.response?.status);

    expect(status).toBe(200);
  });

  it("works with an empty pipe array (no response set)", async () => {
    const { payload } = makeCtx();
    const result = await Pipeline.send(payload).through([]).thenReturn();
    expect(result.response).toBeUndefined();
  });
});

describe("Pipeline — short-circuit", () => {
  it("stops the chain when a pipe returns a Response without calling next()", async () => {
    const { payload, log } = makeCtx();

    const result = await Pipeline.send(payload)
      .through([TagA, ReturnGuard, Responder]) // Responder never runs
      .thenReturn();

    // A returned Response is mirrored onto the canonical ctx.response.
    expect(result.response?.status).toBe(403);
    expect(log).toEqual(["A", "ReturnGuard"]);
    expect(log).not.toContain("Responder");
  });
});

describe("Pipeline — void-returning guard", () => {
  it("a void return preserves the ctx.response the guard set", async () => {
    const { payload } = makeCtx();

    const result = await Pipeline.send(payload).through([VoidGuard]).thenReturn();

    expect(result.response?.status).toBe(401);
  });

  it("a void short-circuit does not let subsequent pipes run", async () => {
    const { payload, log } = makeCtx();

    const result = await Pipeline.send(payload)
      .through([VoidGuard, Responder]) // Responder must NOT run
      .thenReturn();

    expect(log).toContain("VoidGuard");
    expect(log).not.toContain("Responder");
    expect(result.response?.status).toBe(401);
  });
});

describe("Pipeline — wrap / finally", () => {
  // Simulates SessionMiddleware: calls next() inside try, runs cleanup in finally.
  class FinallyMiddleware implements Pipe<HttpContext> {
    async handle(payload: HttpContext, next: NextFn): Promise<Response | void> {
      try {
        return await next();
      } finally {
        logOf(payload).push("cleanup");
      }
    }
  }

  it("outer finally still runs when an inner pipe returns void", async () => {
    const { payload, log } = makeCtx();

    const result = await Pipeline.send(payload)
      .through([FinallyMiddleware, VoidGuard])
      .thenReturn();

    expect(result.response?.status).toBe(401);
    expect(log).toContain("VoidGuard");
    expect(log).toContain("cleanup"); // finally DID execute
  });

  it("a wrapping pipe can transform the downstream response", async () => {
    const { payload } = makeCtx();

    // Outer pipe awaits next() (the downstream Response) and replaces it.
    class Rewrap implements Pipe<HttpContext> {
      async handle(_payload: HttpContext, next: NextFn): Promise<Response | void> {
        const res = await next();
        if (!res) return;
        const headers = new Headers(res.headers);
        headers.set("X-Wrapped", "1");
        return new Response(res.body, { status: res.status, headers });
      }
    }

    const result = await Pipeline.send(payload).through([Rewrap, Responder]).thenReturn();

    expect(result.response?.status).toBe(200);
    expect(result.response?.headers.get("X-Wrapped")).toBe("1");
  });
});
