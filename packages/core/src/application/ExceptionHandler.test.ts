import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { ExceptionHandler } from "./ExceptionHandler.ts";
import { NotFoundError, ForbiddenError, UnauthorizedError, HttpError } from "../errors/index.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

/** Make an HttpContext that looks like a browser request (Accept: text/html). */
function htmlCtx(): HttpContext {
  return new HttpContext(
    new Request("http://localhost/", {
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    }),
    new ScopedResolver(),
  );
}

/** Make an HttpContext that looks like a JSON API request. */
function jsonCtx(): HttpContext {
  return new HttpContext(
    new Request("http://localhost/", { headers: { Accept: "application/json" } }),
    new ScopedResolver(),
  );
}

// ── ExceptionHandler.defaultRender() ─────────────────────────────────────────

describe("ExceptionHandler.defaultRender()", () => {
  it("renders NotFoundError as 404", async () => {
    const res = await ExceptionHandler.defaultRender(new NotFoundError());
    expect(res.status).toBe(404);
  });

  it("renders ForbiddenError as 403", async () => {
    const res = await ExceptionHandler.defaultRender(new ForbiddenError());
    expect(res.status).toBe(403);
  });

  it("renders UnauthorizedError as 401", async () => {
    const res = await ExceptionHandler.defaultRender(new UnauthorizedError());
    expect(res.status).toBe(401);
  });

  it("renders ValidationJsonError as 422 JSON", async () => {
    const err = Object.assign(new Error(), {
      name: "ValidationJsonError",
      errors: { email: "required" },
    });
    const res = await ExceptionHandler.defaultRender(err);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string; errors: Record<string, string> };
    expect(body.message).toBe("Validation failed");
    expect(body.errors["email"]).toBe("required");
  });

  it("renders ValidationRedirectError as 303 with Location", async () => {
    const err = Object.assign(new Error(), {
      name: "ValidationRedirectError",
      redirectTo: "/login",
    });
    const res = await ExceptionHandler.defaultRender(err);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("renders generic Error as 500 dev page in non-production", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("oops"));
    // dev mode (APP_ENV != 'production') returns HTML error page
    expect(res.status).toBe(500);
  });

  it("renders non-Error values as 500", async () => {
    const res = await ExceptionHandler.defaultRender("string error");
    expect(res.status).toBe(500);
  });
});

// ── Custom handler ────────────────────────────────────────────────────────────

class TeapotHandler extends ExceptionHandler {
  override async render(_err: unknown, _ctx: never): Promise<Response> {
    return Response.json({ i_am: "teapot" }, { status: 418 });
  }
}

class SpyHandler extends ExceptionHandler {
  readonly reported: unknown[] = [];
  override async report(err: unknown): Promise<void> {
    this.reported.push(err);
  }
}

describe("ExceptionHandler subclass — render()", () => {
  it("overriding render() replaces the default response", async () => {
    const handler = new TeapotHandler();
    const ctx = {} as never;
    const res = await handler.render(new Error("x"), ctx);
    expect(res.status).toBe(418);
  });

  it("super.render() falls through to defaultRender()", async () => {
    class PassThroughHandler extends ExceptionHandler {
      override async render(err: unknown, ctx: never): Promise<Response> {
        return super.render(err, ctx);
      }
    }
    const handler = new PassThroughHandler();
    const res = await handler.render(new NotFoundError(), {} as never);
    expect(res.status).toBe(404);
  });
});

// ── HTML-client paths (covers _wantsHtml() body + wantsHtml branches) ─────────

describe("ExceptionHandler.defaultRender() — HTML client (browser Accept header)", () => {
  it("renders 4xx ZerotalError as HTML page for browser clients (line 84)", async () => {
    const res = await ExceptionHandler.defaultRender(new NotFoundError(), htmlCtx());
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("renders 5xx ZerotalError as dev stack-trace page for HTML client in dev (lines 79-82)", async () => {
    const err = new HttpError("Server fail", 500, "E_TEST");
    const res = await ExceptionHandler.defaultRender(err, htmlCtx());
    expect(res.status).toBe(500);
  });

  it("renders generic Error as dev HTML page for HTML client in dev (line 96)", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("boom"), htmlCtx());
    expect(res.status).toBe(500);
  });

  it("returns false from _wantsHtml when Accept is application/json (line 127)", async () => {
    const res = await ExceptionHandler.defaultRender(new NotFoundError(), jsonCtx());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(typeof body.message).toBe("string");
  });
});

describe("ExceptionHandler.defaultRender() — production mode (lines 106-109)", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = Bun.env["APP_ENV"];
    (Bun.env as Record<string, string>)["APP_ENV"] = "production";
  });
  afterEach(() => {
    if (saved === undefined) delete (Bun.env as Record<string, string>)["APP_ENV"];
    else (Bun.env as Record<string, string>)["APP_ENV"] = saved;
  });

  it("returns opaque HTML 500 for HTML client in production (lines 106-108)", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("secret"), htmlCtx());
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns opaque JSON 500 for API client in production (line 109)", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("secret"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Internal Server Error");
  });
});

describe("ExceptionHandler.defaultRender() — the serve --dev worker", () => {
  const env = Bun.env as Record<string, string | undefined>;
  let savedAppEnv: string | undefined;
  let savedDevWorker: string | undefined;

  beforeEach(() => {
    savedAppEnv = env["APP_ENV"];
    savedDevWorker = env["ZT_DEV"];
    // What the dev worker actually runs with: APP_ENV holds the runtime mode,
    // so the deployment name the developer configured is long gone by now.
    env["APP_ENV"] = "web";
    env["ZT_DEV"] = "1";
  });
  afterEach(() => {
    if (savedAppEnv === undefined) delete env["APP_ENV"];
    else env["APP_ENV"] = savedAppEnv;
    if (savedDevWorker === undefined) delete env["ZT_DEV"];
    else env["ZT_DEV"] = savedDevWorker;
  });

  it("serves the stack-trace page to a browser instead of a bare 500", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("boom in dev"), htmlCtx());
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("boom in dev");
    expect(body).toContain("Full Stack Trace");
  });

  it("serves the error message to a JSON client instead of a generic string", async () => {
    const res = await ExceptionHandler.defaultRender(new Error("boom in dev"), jsonCtx());
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("boom in dev");
  });

  it("withholds both once the dev-worker flag is gone", async () => {
    delete env["ZT_DEV"];
    const res = await ExceptionHandler.defaultRender(new Error("secret"), htmlCtx());
    expect(await res.text()).not.toContain("secret");
  });
});

describe("ExceptionHandler subclass — report()", () => {
  it("overriding report() receives the error", async () => {
    const handler = new SpyHandler();
    const err = new Error("boom");
    await handler.report(err);
    expect(handler.reported).toHaveLength(1);
    expect(handler.reported[0]).toBe(err);
  });

  it("default report() does not throw", async () => {
    class DefaultHandler extends ExceptionHandler {}
    const handler = new DefaultHandler();
    let threw = false;
    try {
      await handler.report(new Error("silent"));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── _wantsHtml catch branch (lines 130-131) ───────────────────────────────────

describe("ExceptionHandler.defaultRender() — _wantsHtml catch path", () => {
  it("returns a 500 when ctx.request.headers.get throws (catch branch)", async () => {
    // Simulate a ctx where headers.get() throws — should NOT propagate
    const badCtx = {
      request: {
        headers: {
          get: () => {
            throw new Error("broken headers");
          },
        },
      },
    } as unknown as HttpContext;
    const res = await ExceptionHandler.defaultRender(new Error("test"), badCtx);
    expect(res.status).toBe(500);
  });
});
