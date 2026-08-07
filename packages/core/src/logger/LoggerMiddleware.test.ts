import { describe, it, expect, afterEach } from "bun:test";
import { LoggerMiddleware } from "./LoggerMiddleware.ts";
import { LogManager } from "./LogManager.ts";
import { HttpContext } from "@zerotal/core";
import { ScopedResolver } from "@zerotal/core";
import type { LogChannel, LogEntry } from "./types.ts";

function spyManager(): { mgr: LogManager; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const channel: LogChannel = {
    write: async (e) => {
      entries.push(e);
    },
  };
  const mgr = new LogManager(
    { default: "spy", channels: { spy: { driver: "null", level: "debug" } } },
    { hostname: "h", pid: 1 },
    channel,
  );
  return { mgr, entries };
}

function jsonMiddleware(): LoggerMiddleware {
  return new (LoggerMiddleware.with({ format: "json" }) as new () => LoggerMiddleware)();
}

function makeCtx(method = "GET", path = "/test", status = 200): HttpContext {
  const req = new Request(`http://localhost${path}`, { method });
  const ctx = new HttpContext(req, new ScopedResolver());
  ctx.response = new Response("ok", { status });
  return ctx;
}

async function handle(mw: LoggerMiddleware, ctx: HttpContext): Promise<HttpContext> {
  // Mirror the pipeline runner: next() takes no args and returns the downstream
  // response; a Response returned by handle() is written back onto ctx.response.
  const result = await mw.handle(ctx, async () => ctx.response);
  if (result instanceof Response) ctx.response = result;
  return ctx;
}

afterEach(() => {
  LoggerMiddleware.setManager(null as unknown as LogManager);
});

describe("LoggerMiddleware — level by status code", () => {
  it("logs 2xx at info", async () => {
    const { mgr, entries } = spyManager();
    LoggerMiddleware.setManager(mgr);
    await handle(jsonMiddleware(), makeCtx("GET", "/health", 200));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
  });

  it("logs 4xx at warn", async () => {
    const { mgr, entries } = spyManager();
    LoggerMiddleware.setManager(mgr);
    await handle(jsonMiddleware(), makeCtx("GET", "/secret", 404));
    expect(entries[0]?.level).toBe("warn");
  });

  it("logs 5xx at error", async () => {
    const { mgr, entries } = spyManager();
    LoggerMiddleware.setManager(mgr);
    await handle(jsonMiddleware(), makeCtx("GET", "/crash", 500));
    expect(entries[0]?.level).toBe("error");
  });

  it("passes method, path, status, duration, and request id as context", async () => {
    const { mgr, entries } = spyManager();
    LoggerMiddleware.setManager(mgr);
    const ctx = makeCtx("POST", "/api/posts", 201);
    await handle(jsonMiddleware(), ctx);
    const c = entries[0]?.context as Record<string, unknown>;
    expect(c["method"]).toBe("POST");
    expect(c["path"]).toBe("/api/posts");
    expect(c["status"]).toBe(201);
    expect(typeof c["duration_ms"]).toBe("number");
    expect(c["request_id"]).toBe(ctx.requestId);
  });
});

describe("LoggerMiddleware — X-Request-Id", () => {
  it("adds X-Request-Id matching ctx.requestId", async () => {
    const { mgr } = spyManager();
    LoggerMiddleware.setManager(mgr);
    const ctx = makeCtx();
    await handle(jsonMiddleware(), ctx);
    expect(ctx.response?.headers.get("X-Request-Id")).toBe(ctx.requestId);
  });

  it("does not set X-Request-Id when response is absent", async () => {
    const { mgr } = spyManager();
    LoggerMiddleware.setManager(mgr);
    const req = new Request("http://localhost/no-response", { method: "GET" });
    const ctx = new HttpContext(req, new ScopedResolver());
    await handle(jsonMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });
});

describe("LoggerMiddleware — passthrough", () => {
  it("returns the same ctx after calling next", async () => {
    const { mgr } = spyManager();
    LoggerMiddleware.setManager(mgr);
    const ctx = makeCtx();
    const result = await handle(jsonMiddleware(), ctx);
    expect(result).toBe(ctx);
  });

  it("preserves a response set by next()", async () => {
    const { mgr } = spyManager();
    LoggerMiddleware.setManager(mgr);
    const ctx = makeCtx("GET", "/redirect", 200);
    const result = await jsonMiddleware().handle(ctx, async () => {
      ctx.response = new Response("redirecting", { status: 302 });
      return ctx.response;
    });
    if (result instanceof Response) ctx.response = result;
    expect(ctx.response?.status).toBe(302);
  });
});
