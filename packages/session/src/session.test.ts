import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import { SessionConfig } from "./config.ts";
import { CookieDriver, SESSION_ISSUED_AT_KEY } from "./drivers/CookieDriver.ts";
import { RedisDriver } from "./drivers/RedisDriver.ts";
import { SessionManager } from "./SessionManager.ts";
import { SessionMiddleware } from "./SessionMiddleware.ts";
import { AuthSessionMiddleware } from "./AuthSessionMiddleware.ts";
import { SessionCookieOverflowError } from "./errors.ts";

// ── Mock Redis ────────────────────────────────────────────────────────────────
function makeMockRedis() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  } as InstanceType<typeof Bun.Redis>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(cookieHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  return new Request("http://localhost/", { headers });
}

function makeResponse(): Response {
  return new Response("ok");
}

/**
 * Run a middleware the way the request dispatcher does: the pipeline first, then
 * the response finalizers against whatever response ended up on the context.
 *
 * SessionMiddleware persists through a finalizer rather than its own `finally`,
 * because on the error path no response exists until after the pipeline has
 * unwound. Calling `handle()` alone would therefore never write the cookie.
 */
async function runWithDispatcher(
  middleware: SessionMiddleware,
  ctx: HttpContext,
  next: () => Promise<Response | void>,
): Promise<void> {
  try {
    await middleware.handle(ctx as never, next as never);
  } finally {
    if (ctx.response) {
      for (const finalize of ctx._responseFinalizers) await finalize(ctx.response);
    }
  }
}

/** Pull the raw cookie value (everything after `name=`) from a Set-Cookie header. */
function extractCookieValue(setCookieHeader: string, name: string): string | undefined {
  for (const part of setCookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return undefined;
}

// ── CookieDriver ──────────────────────────────────────────────────────────────

describe("CookieDriver", () => {
  const driver = new CookieDriver("test-secret", "session");

  it("returns a fresh session (empty data, new UUID) when no cookie is present", async () => {
    const req = makeRequest();
    const { id, data } = await driver.loadFromRequest(req);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(data).toEqual({});
  });

  it("round-trips: save → load preserves id and data", async () => {
    const sessionId = "fixed-id-for-test";
    const testData = { user_id: 42, theme: "dark" };
    const response = makeResponse();

    await driver.saveSession(sessionId, testData, response);

    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toBeTruthy();

    const cookieVal = extractCookieValue(setCookie, "session")!;
    expect(cookieVal).toBeTruthy();

    const req2 = makeRequest(`session=${cookieVal}`);
    const { id, data } = await driver.loadFromRequest(req2);

    expect(id).toBe(sessionId);
    // The issue time rides in the data bag so the absolute lifetime survives a refresh.
    expect(data).toEqual({ ...testData, [SESSION_ISSUED_AT_KEY]: expect.any(Number) });
  });

  it("rejects a cookie whose idle window has passed", async () => {
    const shortLived = new CookieDriver("test-secret", "session", 1);
    const response = makeResponse();
    await shortLived.saveSession("sid", { user_id: 42 }, response);
    const cookieVal = extractCookieValue(response.headers.get("Set-Cookie")!, "session")!;

    // Server-side, so replaying the cookie past Max-Age gains nothing.
    const realNow = Date.now;
    Date.now = () => realNow() + 2_000;
    try {
      const { data } = await shortLived.loadFromRequest(makeRequest(`session=${cookieVal}`));
      expect(data).toEqual({});
    } finally {
      Date.now = realNow;
    }
  });

  it("refreshing does not extend a session past its absolute lifetime", async () => {
    // Idle window comfortably long, absolute window short: activity must not save it.
    const capped = new CookieDriver("test-secret", "session", 86_400, false, 10);

    let cookieVal: string;
    const first = makeResponse();
    await capped.saveSession("sid", { user_id: 42 }, first);
    cookieVal = extractCookieValue(first.headers.get("Set-Cookie")!, "session")!;

    const realNow = Date.now;
    try {
      // Two refreshes inside the window keep it alive…
      for (const offset of [4_000, 8_000]) {
        Date.now = () => realNow() + offset;
        const loaded = await capped.loadFromRequest(makeRequest(`session=${cookieVal}`));
        expect(loaded.data["user_id"]).toBe(42);
        const res = makeResponse();
        await capped.saveSession(loaded.id, loaded.data, res);
        cookieVal = extractCookieValue(res.headers.get("Set-Cookie")!, "session")!;
      }

      // …but the ceiling is measured from first issue, not from last use.
      Date.now = () => realNow() + 11_000;
      const { data } = await capped.loadFromRequest(makeRequest(`session=${cookieVal}`));
      expect(data).toEqual({});
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects an envelope with no expiry rather than treating it as eternal", async () => {
    // Hand-built envelope in the pre-expiry shape: `{id, data}` and nothing else.
    const forged = new CookieDriver("test-secret", "session");
    const encrypt = (forged as unknown as { _encrypt(plain: string): string })._encrypt.bind(
      forged,
    );
    const cookieVal = encrypt(JSON.stringify({ id: "sid", data: { user_id: 42 } }));

    const { data } = await forged.loadFromRequest(makeRequest(`session=${cookieVal}`));
    expect(data).toEqual({});
  });

  it("rejects a cookie with a tampered payload", async () => {
    const req = makeRequest("session=dGFtcGVyZWQ.invalidsig");
    const { data } = await driver.loadFromRequest(req);
    expect(data).toEqual({});
  });

  it("rejects a cookie with no dot separator", async () => {
    const req = makeRequest("session=nodot");
    const { data } = await driver.loadFromRequest(req);
    expect(data).toEqual({});
  });

  it("sets HttpOnly and Path=/ on the Set-Cookie header", async () => {
    const response = makeResponse();
    await driver.saveSession("some-id", {}, response);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  it("respects a custom cookie name", async () => {
    const custom = new CookieDriver("secret", "my_session");
    const response = makeResponse();
    await custom.saveSession("id", {}, response);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie.startsWith("my_session=")).toBe(true);
  });

  // ── Encrypted payload + size limit ──────────────────────────────────────

  it("cookie contents are encrypted — not client-readable", async () => {
    const response = makeResponse();
    await driver.saveSession("sid-enc", { email: "top@secret.test" }, response);
    const cookieVal = extractCookieValue(response.headers.get("Set-Cookie")!, "session")!;

    // Neither the raw value nor its base64/base64url decoding reveals the payload.
    expect(cookieVal).not.toContain("top@secret.test");
    expect(Buffer.from(cookieVal, "base64url").toString("utf8")).not.toContain("top@secret.test");
    expect(Buffer.from(cookieVal, "base64").toString("utf8")).not.toContain("top@secret.test");
  });

  it("legacy signed-only cookies are treated as an absent session", async () => {
    // Old format: base64(JSON({id,data})) + "." + HMAC-SHA256 hex.
    const payload = Buffer.from(JSON.stringify({ id: "legacy-id", data: { user_id: 1 } })).toString(
      "base64",
    );
    const sig = new Bun.CryptoHasher("sha256", "test-secret").update(payload).digest("hex");

    const req = makeRequest(`session=${payload}.${sig}`);
    const { id, data } = await driver.loadFromRequest(req);
    expect(id).not.toBe("legacy-id"); // fresh session started
    expect(data).toEqual({});
  });

  it("a wrong-key ciphertext is rejected (fresh session)", async () => {
    const other = new CookieDriver("some-other-secret");
    const response = makeResponse();
    await other.saveSession("foreign-id", { user_id: 9 }, response);
    const cookieVal = extractCookieValue(response.headers.get("Set-Cookie")!, "session")!;

    const { id, data } = await driver.loadFromRequest(makeRequest(`session=${cookieVal}`));
    expect(id).not.toBe("foreign-id");
    expect(data).toEqual({});
  });

  it("throws SessionCookieOverflowError when the cookie would exceed 4096 bytes", async () => {
    const response = makeResponse();
    await expect(driver.saveSession("sid", { blob: "x".repeat(5000) }, response)).rejects.toThrow(
      SessionCookieOverflowError,
    );
    // Nothing was emitted — a truncated cookie would corrupt the session.
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("stays under the limit for normal payloads", async () => {
    const response = makeResponse();
    await driver.saveSession("sid", { user_id: 42, theme: "dark" }, response);
    expect(response.headers.get("Set-Cookie")).toBeTruthy();
  });
});

// ── SessionManager ────────────────────────────────────────────────────────────

describe("SessionManager", () => {
  const driver = new CookieDriver("secret");

  it("get() returns undefined for missing key", () => {
    const sm = new SessionManager("id", {}, driver);
    expect(sm.get("missing")).toBeUndefined();
  });

  it("set() and get() round-trip", () => {
    const sm = new SessionManager("id", {}, driver);
    sm.set("foo", "bar");
    expect(sm.get("foo")).toBe("bar");
  });

  it("has() returns true after set, false after forget", () => {
    const sm = new SessionManager("id", {}, driver);
    sm.set("x", 1);
    expect(sm.has("x")).toBe(true);
    sm.forget("x");
    expect(sm.has("x")).toBe(false);
  });

  it("flush() clears all data", () => {
    const sm = new SessionManager("id", { a: 1, b: 2 }, driver);
    sm.flush();
    expect(sm.has("a")).toBe(false);
    expect(sm.has("b")).toBe(false);
  });

  it("regenerate() changes the session ID", () => {
    const sm = new SessionManager("original", {}, driver);
    sm.regenerate();
    expect(sm.id()).not.toBe("original");
    expect(sm.id().length).toBeGreaterThan(0);
  });

  it("id() returns the current session ID", () => {
    const sm = new SessionManager("abc-123", {}, driver);
    expect(sm.id()).toBe("abc-123");
  });

  it("initial data is available via get()", () => {
    const sm = new SessionManager("id", { pre: "loaded" }, driver);
    expect(sm.get("pre")).toBe("loaded");
  });

  // ── Flash semantics ─────────────────────────────────────────────────────

  it("flash() makes the value readable in the same request", () => {
    const sm = new SessionManager("id", {}, driver);
    sm.flash("notice", "Saved!");
    expect(sm.get("notice")).toBe("Saved!");
  });

  it("flash key is swept from session after the next request", () => {
    const sm1 = new SessionManager("id", {}, driver);
    sm1.flash("errors", { email: "required" });

    // Simulate what SessionMiddleware does before saving
    const saved = sm1._prepareForSave();
    expect(saved["errors"]).toEqual({ email: "required" });
    expect(saved["_flash_keys"]).toEqual(["errors"]);

    // Simulate the next request loading the saved data
    const sm2 = new SessionManager("id", { ...saved }, driver);
    // Flash value is available for this (second) request
    expect(sm2.get("errors")).toEqual({ email: "required" });
    expect(sm2.has("errors")).toBe(true);

    // After the second request, the key is swept
    const saved2 = sm2._prepareForSave();
    expect(saved2["errors"]).toBeUndefined();
    expect(saved2["_flash_keys"]).toBeUndefined();
  });

  it("set() data is NOT swept — persists indefinitely", () => {
    const sm1 = new SessionManager("id", {}, driver);
    sm1.set("user_id", 42);
    const saved = sm1._prepareForSave();
    const sm2 = new SessionManager("id", { ...saved }, driver);
    const saved2 = sm2._prepareForSave();
    expect(saved2["user_id"]).toBe(42);
  });

  it("forget() removes a flashed key before it reaches the next request", () => {
    const sm = new SessionManager("id", {}, driver);
    sm.flash("notice", "hi");
    sm.forget("notice");
    const saved = sm._prepareForSave();
    expect(saved["notice"]).toBeUndefined();
    expect(saved["_flash_keys"]).toBeUndefined();
  });
});

// ── SessionMiddleware ─────────────────────────────────────────────────────────

describe("SessionMiddleware", () => {
  const driver = new CookieDriver("mw-secret");
  const middleware = new SessionMiddleware(driver);

  it("withDriver() returns a constructor that creates a working middleware", async () => {
    const MwClass = SessionMiddleware.withDriver(driver);
    const instance = new MwClass();
    expect(instance).toBeInstanceOf(SessionMiddleware);
    const ctx = HttpContext.fake("http://localhost/");
    ctx.response = makeResponse();
    await instance.handle(ctx, async (c) => c);
    expect(ctx.session).toBeInstanceOf(SessionManager);
  });

  it("sets ctx.session on each request", async () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.response = makeResponse();

    await middleware.handle(ctx, async (c) => c);

    expect(ctx.session).toBeInstanceOf(SessionManager);
  });

  it("data set in the session is saved to the response cookie", async () => {
    const ctx = HttpContext.fake("http://localhost/");
    ctx.response = makeResponse();

    await runWithDispatcher(middleware, ctx, async () => {
      (ctx.session as SessionManager).set("user_id", 7);
      return ctx.response;
    });

    const setCookie = ctx.response!.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
  });

  it("data set in request 1 is readable in request 2 (cross-request cookie)", async () => {
    // ── Request 1: write user_id ─────────────────────────────────────
    const ctx1 = HttpContext.fake("http://localhost/");
    ctx1.response = makeResponse();

    await runWithDispatcher(middleware, ctx1, async () => {
      (ctx1.session as SessionManager).set("user_id", 99);
      return ctx1.response;
    });

    const setCookie = ctx1.response!.headers.get("Set-Cookie")!;
    const cookieVal = extractCookieValue(setCookie, "session")!;

    // ── Request 2: cookie from request 1 ─────────────────────────────
    const ctx2 = HttpContext.fake("http://localhost/", {
      headers: { Cookie: `session=${cookieVal}` },
    });
    ctx2.response = makeResponse();

    let readValue: unknown;
    await runWithDispatcher(middleware, ctx2, async () => {
      readValue = (ctx2.session as SessionManager).get("user_id");
      return ctx2.response;
    });

    expect(readValue).toBe(99);
  });

  it("saves the session onto a response built after next() threw", async () => {
    // The shape of a failed validate(): the handler writes to the session and
    // throws, and only then does the exception handler produce the redirect that
    // is supposed to carry the flashed errors. A `finally` inside the middleware
    // would run while ctx.response is still undefined and drop them silently.
    const ctx = HttpContext.fake("http://localhost/");

    try {
      await middleware.handle(ctx as never, async () => {
        (ctx.session as SessionManager).flash("errors", { email: "required" });
        throw new Error("boom");
      });
    } catch {
      // expected — the pipeline unwinds with no response yet
    }

    expect(ctx.response).toBeUndefined();

    // The exception handler renders, then the dispatcher runs the finalizers.
    ctx.response = makeResponse();
    for (const finalize of ctx._responseFinalizers) await finalize(ctx.response);

    const cookie = extractCookieValue(ctx.response.headers.get("Set-Cookie")!, "session")!;
    const ctx2 = HttpContext.fake("http://localhost/", {
      headers: { Cookie: `session=${cookie}` },
    });
    ctx2.response = makeResponse();

    let errors: unknown;
    await runWithDispatcher(middleware, ctx2, async () => {
      errors = (ctx2.session as SessionManager).get("errors");
      return ctx2.response;
    });

    expect(errors).toEqual({ email: "required" });
  });

  it("does not write Set-Cookie when there is no response", async () => {
    const ctx = HttpContext.fake("http://localhost/");
    // ctx.response is undefined

    await middleware.handle(ctx, async (c) => c);

    // No crash and ctx.response is still undefined
    expect(ctx.response).toBeUndefined();
  });

  it("flash() values are available on next request then auto-swept on the one after", async () => {
    // ── Request 1: flash errors ───────────────────────────────────────
    const ctx1 = HttpContext.fake("http://localhost/");
    ctx1.response = makeResponse();
    await runWithDispatcher(middleware, ctx1, async () => {
      (ctx1.session as SessionManager).flash("errors", { email: "required" });
      return ctx1.response;
    });
    const cookie1 = extractCookieValue(ctx1.response!.headers.get("Set-Cookie")!, "session")!;

    // ── Request 2: errors available (the "next request" after flash) ──
    const ctx2 = HttpContext.fake("http://localhost/", {
      headers: { Cookie: `session=${cookie1}` },
    });
    ctx2.response = makeResponse();
    let errors2: unknown;
    await runWithDispatcher(middleware, ctx2, async () => {
      errors2 = (ctx2.session as SessionManager).get("errors");
      return ctx2.response;
    });
    expect(errors2).toEqual({ email: "required" });
    const cookie2 = extractCookieValue(ctx2.response!.headers.get("Set-Cookie")!, "session")!;

    // ── Request 3: errors should be gone (swept after request 2) ─────
    const ctx3 = HttpContext.fake("http://localhost/", {
      headers: { Cookie: `session=${cookie2}` },
    });
    ctx3.response = makeResponse();
    let errors3: unknown;
    await runWithDispatcher(middleware, ctx3, async () => {
      errors3 = (ctx3.session as SessionManager).get("errors");
      return ctx3.response;
    });
    expect(errors3).toBeUndefined();
  });
});

// ── RedisDriver ───────────────────────────────────────────────────────────────

describe("RedisDriver — unsigned (backwards-compatible)", () => {
  it("returns a fresh session when no cookie present", async () => {
    const driver = new RedisDriver(makeMockRedis());
    const req = new Request("http://localhost/");
    const { id, data } = await driver.loadFromRequest(req);
    expect(typeof id).toBe("string");
    expect(data).toEqual({});
  });

  it("round-trips: save → load preserves id and data", async () => {
    const redis = makeMockRedis();
    const driver = new RedisDriver(redis);
    const res = new Response("ok");

    await driver.saveSession("test-id", { user_id: 42 }, res);
    const cookieVal = res.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!;

    const req2 = new Request("http://localhost/", { headers: { Cookie: `session=${cookieVal}` } });
    const { id, data } = await driver.loadFromRequest(req2);
    expect(id).toBe("test-id");
    expect(data).toEqual({ user_id: 42 });
  });
});

describe("RedisDriver — HMAC-signed (Rec 9)", () => {
  const SECRET = "test-hmac-secret";

  it("cookie value is signed (id.signature format)", async () => {
    const driver = new RedisDriver(makeMockRedis(), "session", 86400, SECRET);
    const res = new Response("ok");
    await driver.saveSession("my-raw-uuid", {}, res);

    const setCookie = res.headers.get("Set-Cookie")!;
    const cookieVal = setCookie.split(";")[0]!.split("=")[1]!;

    // signed form must contain a dot separator
    expect(cookieVal).toContain(".");
    // raw id is the prefix before the first dot-from-end
    expect(cookieVal.startsWith("my-raw-uuid.")).toBe(true);
  });

  it("save → load round-trip verifies signature and returns raw id", async () => {
    const redis = makeMockRedis();
    const driver = new RedisDriver(redis, "session", 86400, SECRET);
    const res = new Response("ok");

    await driver.saveSession("raw-id-123", { role: "admin" }, res);
    const cookieVal = res.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!;

    const req2 = new Request("http://localhost/", { headers: { Cookie: `session=${cookieVal}` } });
    const { id, data } = await driver.loadFromRequest(req2);

    // Manager always sees the raw (unsigned) ID
    expect(id).toBe("raw-id-123");
    expect(data).toEqual({ role: "admin" });
  });

  it("rejects a tampered cookie — returns a fresh session without Redis hit", async () => {
    const redis = makeMockRedis();
    const driver = new RedisDriver(redis, "session", 86400, SECRET);
    // Seed a real session
    await redis.set("session:real-id", JSON.stringify({ secret: "data" }));

    // Cookie with wrong signature
    const tampered = "real-id.invalidsignatureXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const req = new Request("http://localhost/", { headers: { Cookie: `session=${tampered}` } });
    const { data } = await driver.loadFromRequest(req);

    // Must NOT see the seeded data — rejection before Redis lookup
    expect(data).toEqual({});
  });

  it("rejects a cookie with no dot separator", async () => {
    const driver = new RedisDriver(makeMockRedis(), "session", 86400, SECRET);
    const req = new Request("http://localhost/", { headers: { Cookie: "session=nodot" } });
    const { data } = await driver.loadFromRequest(req);
    expect(data).toEqual({});
  });

  it("two sessions with same data produce different cookie values (ID randomness)", async () => {
    const driver = new RedisDriver(makeMockRedis(), "session", 86400, SECRET);
    const res1 = new Response("ok");
    const res2 = new Response("ok");
    await driver.saveSession("id-A", { x: 1 }, res1);
    await driver.saveSession("id-B", { x: 1 }, res2);
    const c1 = res1.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!;
    const c2 = res2.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!;
    expect(c1).not.toBe(c2);
  });
});

describe("RedisDriver — regenerate() invalidates the old session key", () => {
  it("the pre-regeneration Redis key is destroyed after the middleware saves", async () => {
    const redis = makeMockRedis();
    const driver = new RedisDriver(redis);
    // Seed a session under the old ID (e.g. planted pre-auth — fixation setup).
    await redis.set("session:old-id", JSON.stringify({ role: "guest" }));

    const mw = new SessionMiddleware(driver);
    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Cookie: "session=old-id" },
    });
    ctx.response = makeResponse();

    await runWithDispatcher(mw, ctx, async () => {
      (ctx.session as SessionManager).regenerate(); // e.g. on login
      return ctx.response;
    });

    const newId = (ctx.session as SessionManager).id();
    expect(newId).not.toBe("old-id");
    // Old key gone — the planted ID can no longer resolve a session.
    expect(await redis.get("session:old-id")).toBeNull();
    // New key persisted.
    expect(await redis.get(`session:${newId}`)).toBeTruthy();
  });
});

// ── SessionConfig factory ─────────────────────────────────────────────────────

describe("SessionConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = SessionConfig();
    expect(cfg.driver).toBe("cookie");
    expect(cfg.lifetime).toBe(86400);
    expect(cfg.cookie).toBe("session");
    expect(cfg.httpOnly).toBe(true);
    expect(cfg.sameSite).toBe("Lax");
    expect(cfg.secure).toBe(false);
    expect(cfg.secret).toBe("");
  });

  it("overrides work", () => {
    const cfg = SessionConfig({ lifetime: 3600, cookie: "app_session" });
    expect(cfg.lifetime).toBe(3600);
    expect(cfg.cookie).toBe("app_session");
    expect(cfg.driver).toBe("cookie");
  });
});

// ── AuthSessionMiddleware ─────────────────────────────────────────────────────

describe("AuthSessionMiddleware", () => {
  const driver = new CookieDriver("auth-secret");

  it("sets ctx.user when user_id is in session", async () => {
    const fakeUser = { id: 5, email: "test@example.com" };
    const findUser = async (id: number) => (id === 5 ? fakeUser : null);
    const mw = new AuthSessionMiddleware(driver, findUser as never);

    // Seed a cookie that has user_id=5
    const seed = makeResponse();
    await driver.saveSession("sid", { user_id: 5 }, seed);
    const setCookie = seed.headers.get("Set-Cookie")!;
    const cookieVal = extractCookieValue(setCookie, "session")!;

    const ctx = HttpContext.fake("http://localhost/", {
      headers: { Cookie: `session=${cookieVal}` },
    });
    ctx.response = makeResponse();

    await mw.handle(ctx, async (c) => c);

    expect(ctx.user).toEqual(fakeUser);
  });

  it("leaves ctx.user undefined when no user_id is in session", async () => {
    const findUser = async (_id: number) => null;
    const mw = new AuthSessionMiddleware(driver, findUser as never);

    const ctx = HttpContext.fake("http://localhost/");
    ctx.response = makeResponse();

    await mw.handle(ctx, async (c) => c);

    expect(ctx.user).toBeUndefined();
  });
});

// ── SessionAccessor ───────────────────────────────────────────────────────────

import { SessionAccessor } from "./SessionAccessor.ts";
import { RequestContext } from "@zerotal/core";

describe("SessionAccessor", () => {
  function makeMockSession(store: Map<string, unknown> = new Map()) {
    return {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => store.set(k, v),
      has: (k: string) => store.has(k),
      forget: (k: string) => store.delete(k),
      flush: () => store.clear(),
      regenerate: () => {},
      id: () => "test-session-id",
    };
  }

  it("get() returns undefined when no active session", () => {
    const accessor = new SessionAccessor();
    expect(accessor.get("key")).toBeUndefined();
  });

  it("has() returns false when no active session", () => {
    const accessor = new SessionAccessor();
    expect(accessor.has("key")).toBe(false);
  });

  it("id() returns empty string when no active session", () => {
    const accessor = new SessionAccessor();
    expect(accessor.id()).toBe("");
  });

  it("set/get/has/forget/flush/regenerate/id work with an active session", async () => {
    const store = new Map<string, unknown>();
    const mockSession = makeMockSession(store);

    await RequestContext.run({ session: mockSession } as any, async () => {
      const accessor = new SessionAccessor();
      accessor.set("name", "Alice");
      expect(accessor.get("name")).toBe("Alice");
      expect(accessor.has("name")).toBe(true);
      accessor.forget("name");
      expect(accessor.has("name")).toBe(false);
      accessor.set("x", 1);
      accessor.flush();
      expect(accessor.has("x")).toBe(false);
      accessor.regenerate(); // no-op in mock
      expect(accessor.id()).toBe("test-session-id");
    });
  });
});
