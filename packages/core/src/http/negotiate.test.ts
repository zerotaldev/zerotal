import { describe, it, expect } from "bun:test";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { negotiate, detectChannel } from "./negotiate.ts";
import type { WebContext, ApiContext, CliContext } from "./negotiate.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(headers: Record<string, string> = {}): HttpContext {
  return HttpContext.fake("http://localhost/", { headers });
}

// ── detectChannel ─────────────────────────────────────────────────────────────

describe("detectChannel", () => {
  it('defaults to "web"', () => {
    expect(detectChannel(makeCtx())).toBe("web");
  });

  it('returns "json" when Accept: application/json', () => {
    expect(detectChannel(makeCtx({ Accept: "application/json" }))).toBe("json");
  });

  it('returns "json" when Accept includes application/json among others', () => {
    expect(detectChannel(makeCtx({ Accept: "text/html, application/json, */*" }))).toBe("json");
  });

  it('returns "cli" when X-Zerotal-Channel: cli header is present', () => {
    expect(detectChannel(makeCtx({ "X-Zerotal-Channel": "cli" }))).toBe("cli");
  });

  it('returns "cli" for curl user-agent', () => {
    expect(detectChannel(makeCtx({ "User-Agent": "curl/7.88.1" }))).toBe("cli");
  });

  it('returns "cli" for wget user-agent', () => {
    expect(detectChannel(makeCtx({ "User-Agent": "Wget/1.21.3" }))).toBe("cli");
  });

  it('returns "cli" for HTTPie user-agent', () => {
    expect(detectChannel(makeCtx({ "User-Agent": "HTTPie/3.2.1" }))).toBe("cli");
  });

  it("X-Zerotal-Channel: cli takes priority over Accept: application/json", () => {
    expect(
      detectChannel(
        makeCtx({
          "X-Zerotal-Channel": "cli",
          Accept: "application/json",
        }),
      ),
    ).toBe("cli");
  });

  it("ignores unrelated User-Agent values", () => {
    expect(detectChannel(makeCtx({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0)" }))).toBe("web");
  });
});

// ── negotiate() — branch routing ──────────────────────────────────────────────

describe("negotiate — branch routing", () => {
  it("calls web branch for plain browser requests", async () => {
    const ctx = makeCtx();
    let called = "";
    await negotiate(ctx)({
      web: () => {
        called = "web";
      },
      json: () => {
        called = "json";
      },
    });
    expect(called).toBe("web");
  });

  it("calls json branch when Accept: application/json", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    let called = "";
    await negotiate(ctx)({
      web: () => {
        called = "web";
      },
      json: () => {
        called = "json";
      },
    });
    expect(called).toBe("json");
  });

  it("calls cli branch when X-Zerotal-Channel: cli", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    let called = "";
    await negotiate(ctx)({
      web: () => {
        called = "web";
      },
      json: () => {
        called = "json";
      },
      cli: () => {
        called = "cli";
      },
    });
    expect(called).toBe("cli");
  });

  it("falls back to json branch when CLI channel has no cli handler", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    let called = "";
    await negotiate(ctx)({
      web: () => {
        called = "web";
      },
      json: () => {
        called = "json";
      },
    });
    expect(called).toBe("json");
  });

  it("awaits async branch handlers", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    let resolved = false;
    await negotiate(ctx)({
      web: async () => {},
      json: async (a) => {
        await Promise.resolve();
        resolved = true;
        a.json({ ok: true });
      },
    });
    expect(resolved).toBe(true);
  });

  it("returns the branch handler return value", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    const result = await negotiate(ctx)({
      web: () => "web-result" as string,
      json: () => "json-result" as string,
    });
    expect(result).toBe("json-result");
  });
});

// ── WebContext ────────────────────────────────────────────────────────────────

describe("negotiate — WebContext", () => {
  it("redirect() sets a redirect response", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({
      web: (w: WebContext) => w.redirect("/dashboard"),
      json: () => {},
    });
    expect(ctx.response?.status).toBe(302);
    expect(ctx.response?.headers.get("Location")).toBe("/dashboard");
  });

  it("redirect() respects explicit status code", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({ web: (w) => w.redirect("/login", 303), json: () => {} });
    expect(ctx.response?.status).toBe(303);
  });

  it("back() redirects to Referer", async () => {
    const ctx = HttpContext.fake("http://localhost/current", {
      headers: { Referer: "http://localhost/previous" },
    });
    await negotiate(ctx)({ web: (w) => w.back(), json: () => {} });
    expect(ctx.response?.headers.get("Location")).toBe("http://localhost/previous");
  });

  it("view() sets an HTML response with DOCTYPE", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({ web: (w) => w.view("<html><body>Hello</body></html>"), json: () => {} });
    expect(ctx.response?.status).toBe(200);
    const body = await ctx.response!.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("html() sets a raw HTML response without DOCTYPE", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({ web: (w) => w.html("<p>Hello</p>"), json: () => {} });
    const body = await ctx.response!.text();
    expect(body).toBe("<p>Hello</p>");
    expect(body).not.toContain("<!DOCTYPE html>");
  });

  it("json() sets a JSON response (useful for web+JSON hybrid endpoints)", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({ web: (w) => w.json({ ok: true }, 201), json: () => {} });
    expect(ctx.response?.status).toBe(201);
    expect(await ctx.response!.json()).toEqual({ ok: true });
  });

  it("flash() and flashed() are no-ops without an active session", async () => {
    const ctx = makeCtx();
    await negotiate(ctx)({
      web: (w) => {
        w.flash("success", "Post saved!");
        expect(w.flashed("success")).toBeUndefined();
      },
      json: () => {},
    });
  });
});

// ── ApiContext ────────────────────────────────────────────────────────────────

describe("negotiate — ApiContext", () => {
  it("json() sets a JSON response with correct status", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    await negotiate(ctx)({
      web: () => {},
      json: (a: ApiContext) => a.json({ data: [1, 2, 3] }, 201),
    });
    expect(ctx.response?.status).toBe(201);
    expect(await ctx.response!.json()).toEqual({ data: [1, 2, 3] });
  });

  it("json() defaults to status 200", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    await negotiate(ctx)({ web: () => {}, json: (a) => a.json({ ok: true }) });
    expect(ctx.response?.status).toBe(200);
  });

  it("bearerToken() extracts the token from Authorization header", async () => {
    const ctx = makeCtx({ Accept: "application/json", Authorization: "Bearer secret123" });
    let token: string | null = null;
    await negotiate(ctx)({
      web: () => {},
      json: (a) => {
        token = a.bearerToken();
      },
    });
    expect(token).toBe("secret123");
  });

  it("bearerToken() returns null when header is absent", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    let token: string | null = null;
    await negotiate(ctx)({
      web: () => {},
      json: (a) => {
        token = a.bearerToken();
      },
    });
    expect(token).toBeNull();
  });

  it("ctx is the underlying HttpContext", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    let captured: HttpContext | undefined;
    await negotiate(ctx)({
      web: () => {},
      json: (a) => {
        captured = a.ctx;
      },
    });
    expect(captured).toBe(ctx);
  });
});

// ── CliContext ────────────────────────────────────────────────────────────────

describe("negotiate — CliContext", () => {
  it("text() sets a plain-text response", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({
      web: () => {},
      json: () => {},
      cli: (c: CliContext) => c.text("hello world", 200),
    });
    expect(ctx.response?.status).toBe(200);
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/plain");
    expect(await ctx.response!.text()).toContain("hello world");
  });

  it("text() defaults to status 200", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({ web: () => {}, json: () => {}, cli: (c) => c.text("ok") });
    expect(ctx.response?.status).toBe(200);
  });

  it("error() sets a 500 response", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({ web: () => {}, json: () => {}, cli: (c) => c.error("boom") });
    expect(ctx.response?.status).toBe(500);
  });

  it("success() sets a 200 response", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({ web: () => {}, json: () => {}, cli: (c) => c.success("done") });
    expect(ctx.response?.status).toBe(200);
  });

  it("warn() sets a 200 response", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({ web: () => {}, json: () => {}, cli: (c) => c.warn("careful") });
    expect(ctx.response?.status).toBe(200);
  });

  it("info() sets a 200 response", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({ web: () => {}, json: () => {}, cli: (c) => c.info("note") });
    expect(ctx.response?.status).toBe(200);
  });

  it("write() and writeln() write to stdout without setting HTTP response", async () => {
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
      output.push(s);
      return true;
    };
    try {
      const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
      await negotiate(ctx)({
        web: () => {},
        json: () => {},
        cli: (c) => {
          c.writeln("hello");
          c.write("world");
        },
      });
      expect(output.join("")).toContain("hello");
      expect(output.join("")).toContain("world");
      expect(ctx.response).toBeUndefined(); // HTTP response not set
    } finally {
      process.stdout.write = original;
    }
  });

  it("line() writes a colored line to stdout", async () => {
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
      output.push(s);
      return true;
    };
    try {
      const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
      await negotiate(ctx)({
        web: () => {},
        json: () => {},
        cli: (c) => c.line("test message", "green"),
      });
      expect(output.join("")).toContain("test message");
    } finally {
      process.stdout.write = original;
    }
  });
});

// ── Middleware usage pattern ───────────────────────────────────────────────────

describe("negotiate — middleware pattern", () => {
  it("blocks unauthenticated web requests with a redirect", async () => {
    const ctx = makeCtx(); // web request, no user
    await negotiate(ctx)({
      web: (w) => w.redirect("/login"),
      json: (a) => a.json({ message: "Unauthenticated." }, 401),
    });
    expect(ctx.response?.status).toBe(302);
    expect(ctx.response?.headers.get("Location")).toBe("/login");
  });

  it("blocks unauthenticated API requests with 401 JSON", async () => {
    const ctx = makeCtx({ Accept: "application/json" });
    await negotiate(ctx)({
      web: (w) => w.redirect("/login"),
      json: (a) => a.json({ message: "Unauthenticated." }, 401),
    });
    expect(ctx.response?.status).toBe(401);
    expect(await ctx.response!.json()).toEqual({ message: "Unauthenticated." });
  });

  it("blocks unauthenticated CLI requests with plain-text error", async () => {
    const ctx = makeCtx({ "X-Zerotal-Channel": "cli" });
    await negotiate(ctx)({
      web: (w) => w.redirect("/login"),
      json: (a) => a.json({ message: "Unauthenticated." }, 401),
      cli: (c) => c.error("Authentication required."),
    });
    expect(ctx.response?.status).toBe(500);
    const body = await ctx.response!.text();
    expect(body).toContain("Authentication required.");
  });
});
