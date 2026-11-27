import { describe, it, expect } from "bun:test";
import { HttpContext, HttpError } from "@zerotal/core";
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

// ── The `_token` form field ───────────────────────────────────────────────────
//
// The token used to be read from a header only, and a plain HTML form cannot send one: with the
// middleware on, every form in the Flow starter was a 419.

/** A form request carrying `body`, in a session holding `token`. */
function formCtx(method: string, body: BodyInit, token: string, headers: HeadersInit = {}) {
  const req = new Request("http://localhost/test", { method, body, headers });
  const ctx = new HttpContext(req, null as never);
  (ctx as unknown as Record<string, unknown>)["session"] = new SessionManager(
    "id",
    { _csrf_token: token },
    driver,
  );
  return ctx;
}

describe("CsrfMiddleware reads the token from a form", () => {
  it("accepts it as the _token field of a urlencoded form", async () => {
    const ctx = formCtx(
      "POST",
      new URLSearchParams({ _token: "form-token", name: "Ada" }),
      "form-token",
    );
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("accepts it as the _token field of a multipart form", async () => {
    const form = new FormData();
    form.set("_token", "multipart-token");
    form.set("avatar", new File(["x"], "a.png", { type: "image/png" }));
    const ctx = formCtx("PUT", form, "multipart-token");
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("leaves the body for the handler to read, in any way it reads it", async () => {
    const ctx = formCtx("POST", new URLSearchParams({ _token: "t", name: "Ada" }), "t");
    let raw = "";
    let parsed: Record<string, unknown> = {};
    await run(new CsrfMiddleware(), ctx, async () => {
      raw = await ctx.request.clone().text();
      parsed = await ctx.body();
    });
    expect(raw).toBe("_token=t&name=Ada");
    expect(parsed["name"]).toBe("Ada");

    const multipart = new FormData();
    multipart.set("_token", "m");
    multipart.set("file", new File(["hello"], "hello.txt"));
    const upload = formCtx("POST", multipart, "m");
    let file: unknown;
    await run(new CsrfMiddleware(), upload, async () => {
      file = (await upload.request.formData()).get("file");
    });
    expect(file).toBeInstanceOf(File);
  });

  it("refuses a form whose _token is wrong, missing or empty", async () => {
    for (const body of [{ _token: "wrong" }, { name: "Ada" }, { _token: "" }]) {
      const ctx = formCtx("POST", new URLSearchParams(body), "right");
      await run(new CsrfMiddleware(), ctx);
      expect(ctx.response?.status).toBe(419);
    }
  });

  it("does not read _token from a JSON body", async () => {
    const ctx = formCtx("POST", JSON.stringify({ _token: "t" }), "t", {
      "Content-Type": "application/json",
    });
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
  });

  it("does not read a form larger than 1 MB, or one another site sent", async () => {
    const big = formCtx(
      "POST",
      new URLSearchParams({ _token: "t", blob: "x".repeat(1024 * 1024) }),
      "t",
    );
    await run(new CsrfMiddleware(), big);
    expect(big.response?.status).toBe(419);

    const crossSite = formCtx("POST", new URLSearchParams({ _token: "t" }), "t", {
      "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "cross-site",
    });
    await run(new CsrfMiddleware(), crossSite);
    expect(crossSite.response?.status).toBe(419);
  });

  it("refuses a request whose session had no token yet, without reading its body", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: new URLSearchParams({ _token: "guess" }),
    });
    const ctx = new HttpContext(req, null as never);
    (ctx as unknown as Record<string, unknown>)["session"] = new SessionManager("id", {}, driver);
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
    expect(req.bodyUsed).toBe(false);
  });

  it("sends a browser posting a page's form to the app's 419 page", async () => {
    const ctx = formCtx("POST", new URLSearchParams({ _token: "stale" }), "right", {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
    });
    const thrown = await run(new CsrfMiddleware(), ctx).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(HttpError);
    expect((thrown as HttpError).status).toBe(419);

    // A script asking for HTML too still gets JSON.
    const script = formCtx("POST", new URLSearchParams({ _token: "stale" }), "right", {
      Accept: "text/html",
      "X-Requested-With": "XMLHttpRequest",
    });
    await run(new CsrfMiddleware(), script);
    expect(script.response?.status).toBe(419);
  });

  it("prefers the header when both are sent", async () => {
    const ctx = formCtx("POST", new URLSearchParams({ _token: "t" }), "t", {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-csrf-token": "wrong",
    });
    await run(new CsrfMiddleware(), ctx);
    expect(ctx.response?.status).toBe(419);
  });
});

describe("CsrfMiddleware.field()", () => {
  it("renders the hidden field holding the session's token", () => {
    const ctx = makeCtx("GET", undefined, 'tok"en');
    const field = CsrfMiddleware.field(ctx);
    expect(field.html).toBe('<input type="hidden" name="_token" value="tok&quot;en">');
    expect(`${field}`).toBe(field.html);
  });

  it("renders nothing without a token, or outside a request", () => {
    const req = new Request("http://localhost/test");
    expect(CsrfMiddleware.field(new HttpContext(req, null as never)).html).toBe("");
    expect(CsrfMiddleware.field().html).toBe("");
  });
});
