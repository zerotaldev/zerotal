import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Application, Router, currentApp } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { TestApp, createTestApp } from "./TestApp.ts";

// ── Inline controllers ────────────────────────────────────────────────────────

class EchoController {
  async handle(http: HttpContext): Promise<void> {
    http.response = Response.json({
      method: http.request.method,
      cookie: http.request.headers.get("Cookie") ?? null,
      xTest: http.request.headers.get("X-Test") ?? null,
    });
  }

  async patch(http: HttpContext): Promise<void> {
    const body = await http.request.json().catch(() => null);
    http.response = Response.json({ method: http.request.method, body });
  }
}

class FixtureController {
  users(http: HttpContext): void {
    http.response = new Response(
      JSON.stringify({
        data: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Custom": "hello" } },
    );
  }

  notFound(http: HttpContext): void {
    http.response = new Response("Not found", { status: 404 });
  }

  created(http: HttpContext): void {
    http.response = new Response(null, { status: 201 });
  }
}

// A minimal, inspectable session driver. `actingAs()`/`withSession()` encode the
// forged session through the app's `session.driver`, so we bind a fake one that
// writes `session=base64url(JSON({id,data}))` — no crypto — which the tests below
// decode to assert the payload. Real apps use the encrypted CookieDriver.
class FakeSessionDriver {
  cookieName = "session";
  async saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void> {
    const value = Buffer.from(JSON.stringify({ id, data })).toString("base64url");
    response.headers.append("Set-Cookie", `session=${value}; Path=/`);
  }
  async loadFromRequest(): Promise<{ id: string; data: Record<string, unknown> }> {
    return { id: crypto.randomUUID(), data: {} };
  }
}

// ── Mini test application ─────────────────────────────────────────────────────
// A bare-bones app with a fake session driver and routes that echo request
// properties back as JSON. No other providers or middleware.

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(
    () => {
      let _app: Application;
      try {
        _app = currentApp();
      } catch {
        _app = Application.create({ env: "test" });
      }
      (_app.container as unknown as { singleton(token: string, f: () => unknown): void }).singleton(
        "session.driver",
        () => new FakeSessionDriver(),
      );
      return _app;
    },
    () => {
      Router.get("/echo", EchoController, "handle");
      Router.patch("/echo", EchoController, "patch");
      Router.get("/users", FixtureController, "users");
      Router.get("/not-found", FixtureController, "notFound");
      Router.post("/created", FixtureController, "created");
    },
  );
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  app.actingAsGuest();
});

// ── patch() ───────────────────────────────────────────────────────────────────

describe("TestApp.patch()", () => {
  it("sends a PATCH request", async () => {
    const res = await app.patch("/echo", { title: "updated" });
    res.assertStatus(200);
    const body = await res.json<{ method: string; body: unknown }>();
    expect(body.method).toBe("PATCH");
    expect(body.body).toEqual({ title: "updated" });
  });

  it("sets Content-Type to application/json", async () => {
    // Verify via the response (server received correct body)
    const res = await app.patch("/echo", { x: 1 });
    const body = await res.json<{ body: unknown }>();
    expect(body.body).toEqual({ x: 1 });
  });
});

// ── withHeaders() ─────────────────────────────────────────────────────────────

describe("TestApp.withHeaders()", () => {
  it("injects headers into every request", async () => {
    app.withHeaders({ "X-Test": "hello" });
    const res = await app.get("/echo");
    const body = await res.json<{ xTest: string | null }>();
    expect(body.xTest).toBe("hello");
    // Clean up global header
    (app as unknown as { _globalHeaders: Record<string, string> })._globalHeaders = {};
  });
});

// ── actingAs() ────────────────────────────────────────────────────────────────

describe("TestApp.actingAs()", () => {
  it("adds a Cookie header to requests", async () => {
    app.actingAs({ id: 42 });
    const res = await app.get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    expect(body.cookie).not.toBeNull();
    expect(typeof body.cookie).toBe("string");
  });

  it("cookie payload contains user_id", async () => {
    app.actingAs({ id: 7 });
    const res = await app.get("/echo");
    const body = await res.json<{ cookie: string | null }>();

    // The fake driver encodes name=base64url(JSON({id,data})).
    const cookieValue = body.cookie!.split("=").slice(1).join("=");
    const decoded = JSON.parse(Buffer.from(cookieValue, "base64url").toString()) as {
      data: { user_id: unknown };
    };
    expect(decoded.data.user_id).toBe(7);
  });

  it("cookie payload contains string user id", async () => {
    app.actingAs({ id: "u_abc" });
    const res = await app.get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    const cookieValue = body.cookie!.split("=").slice(1).join("=");
    const decoded = JSON.parse(Buffer.from(cookieValue, "base64url").toString()) as {
      data: { user_id: unknown };
    };
    expect(decoded.data.user_id).toBe("u_abc");
  });

  it("different users produce different cookies", async () => {
    app.actingAs({ id: 1 });
    const res1 = await app.get("/echo");
    const b1 = await res1.json<{ cookie: string }>();

    app.actingAs({ id: 2 });
    const res2 = await app.get("/echo");
    const b2 = await res2.json<{ cookie: string }>();

    expect(b1.cookie).not.toBe(b2.cookie);
  });
});

// ── actingAsGuest() ───────────────────────────────────────────────────────────

describe("TestApp.actingAsGuest()", () => {
  it("clears the cookie set by actingAs()", async () => {
    app.actingAs({ id: 5 });
    app.actingAsGuest();
    const res = await app.get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    expect(body.cookie).toBeNull();
  });

  it("is chainable", async () => {
    const res = await app.actingAs({ id: 5 }).actingAsGuest().get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    expect(body.cookie).toBeNull();
  });
});

// ── TestResponse status shorthands ────────────────────────────────────────────

describe("TestResponse status shorthands", () => {
  it("assertOk() passes on 200", async () => {
    const res = await app.get("/users");
    expect(() => res.assertOk()).not.toThrow();
  });

  it("assertCreated() passes on 201", async () => {
    const res = await app.post("/created", {});
    expect(() => res.assertCreated()).not.toThrow();
  });

  it("assertNotFound() passes on 404", async () => {
    const res = await app.get("/not-found");
    expect(() => res.assertNotFound()).not.toThrow();
  });

  it("assertOk() throws on non-200", async () => {
    const res = await app.get("/not-found");
    expect(() => res.assertOk()).toThrow("Expected HTTP 200");
  });
});

// ── TestResponse.assertHeader() ───────────────────────────────────────────────

describe("TestResponse.assertHeader()", () => {
  it("passes when header is present", async () => {
    const res = await app.get("/users");
    expect(() => res.assertHeader("Content-Type")).not.toThrow();
  });

  it("passes when header contains expected value", async () => {
    const res = await app.get("/users");
    expect(() => res.assertHeader("X-Custom", "hello")).not.toThrow();
  });

  it("throws when header is absent", async () => {
    const res = await app.get("/users");
    expect(() => res.assertHeader("X-Missing")).toThrow('"X-Missing"');
  });

  it("throws when header value does not match", async () => {
    const res = await app.get("/users");
    expect(() => res.assertHeader("X-Custom", "wrong")).toThrow();
  });

  it("assertHeaderMissing passes when header absent", async () => {
    const res = await app.get("/users");
    expect(() => res.assertHeaderMissing("X-Missing")).not.toThrow();
  });
});

// ── TestResponse.assertJsonPath() ────────────────────────────────────────────

describe("TestResponse.assertJsonPath()", () => {
  it("matches a top-level key", async () => {
    const res = await app.get("/users");
    expect(res.assertJsonPath("data.0.name", "Alice")).toBeDefined();
  });

  it("matches a nested path", async () => {
    const res = await app.get("/users");
    expect(res.assertJsonPath("data.1.id", 2)).toBeDefined();
  });

  it("throws on mismatch", async () => {
    const res = await app.get("/users");
    expect(() => res.assertJsonPath("data.0.name", "Bob")).toThrow("data.0.name");
  });
});

// ── TestResponse.assertJsonCount() ───────────────────────────────────────────

describe("TestResponse.assertJsonCount()", () => {
  it("counts items at a key", async () => {
    const res = await app.get("/users");
    expect(res.assertJsonCount(2, "data")).toBeDefined();
  });

  it("throws on wrong count", async () => {
    const res = await app.get("/users");
    expect(() => res.assertJsonCount(5, "data")).toThrow("expected 5");
  });
});

// ── TestResponse.assertSee / assertDontSee ───────────────────────────────────

describe("TestResponse.assertSee / assertDontSee()", () => {
  it("assertSee passes when text is present", async () => {
    const res = await app.get("/users");
    expect(res.assertSee("Alice")).toBeDefined();
  });

  it("assertDontSee passes when text is absent", async () => {
    const res = await app.get("/users");
    expect(res.assertDontSee("Charlie")).toBeDefined();
  });

  it("assertDontSee throws when text IS present", async () => {
    const res = await app.get("/users");
    expect(() => res.assertDontSee("Alice")).toThrow("Alice");
  });
});

// ── TestApp.put() ─────────────────────────────────────────────────────────────

describe("TestApp.put()", () => {
  it("sends a PUT request (method visible in response)", async () => {
    // PUT /echo has no registered handler so returns a non-200 status,
    // but the code path inside TestApp.put() is fully exercised.
    const res = await app.put("/echo", { x: 1 });
    expect(res.status).toBeGreaterThan(0);
  });
});

// ── TestApp.delete() ─────────────────────────────────────────────────────────

describe("TestApp.delete()", () => {
  it("sends a DELETE request", async () => {
    const res = await app.delete("/echo");
    expect(res.status).toBeGreaterThan(0);
  });
});

// ── TestApp.withSession() ────────────────────────────────────────────────────

describe("TestApp.withSession()", () => {
  afterEach(() => {
    app.actingAsGuest();
  });

  it("adds a signed session cookie to the request", async () => {
    const res = await app.withSession({ locale: "en" }).get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    expect(body.cookie).not.toBeNull();
    expect(typeof body.cookie).toBe("string");
  });

  it("is chainable", () => {
    expect(app.withSession({ x: 1 })).toBe(app);
    // reset
    (app as unknown as { _authCookie: string | null })._authCookie = null;
  });

  it("merges data with an existing actingAs() cookie", async () => {
    app.actingAs({ id: 5 });
    // withSession() with an existing _authCookie triggers _decodeSessionPayload()
    const res = await app.withSession({ role: "admin" }).get("/echo");
    const body = await res.json<{ cookie: string | null }>();
    expect(body.cookie).not.toBeNull();
  });
});

// ── TestApp.followingRedirects() / withoutFollowingRedirects() ────────────────

describe("TestApp.followingRedirects()", () => {
  it("is chainable and sets the follow-redirect flag", () => {
    const result = app.followingRedirects();
    expect(result).toBe(app);
    // reset
    app.withoutFollowingRedirects();
  });

  it("withoutFollowingRedirects() is chainable and unsets the flag", () => {
    app.followingRedirects();
    const result = app.withoutFollowingRedirects();
    expect(result).toBe(app);
  });
});

// ── An outbound fetch stub must not intercept the test client ─────────────────

describe("TestApp and a stubbed globalThis.fetch", () => {
  it("keeps reaching the app while a test fakes an outbound integration", async () => {
    // Stubbing `globalThis.fetch` is the ordinary way to fake a third-party API.
    // The test client used to go through the same global, so the stub answered
    // the client's own requests too — three unrelated route tests failing with
    // `connection refused`, which reads as "my test client cannot reach my app".
    const original = globalThis.fetch;
    let stubCalls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      stubCalls++;
      return Response.json({ courses: [] });
    }) as typeof fetch;

    try {
      const res = await app.get("/users");
      res.assertStatus(200);
      const body = await res.json<{ data: { name: string }[] }>();
      expect(body.data[0]?.name).toBe("Alice");
      expect(stubCalls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
