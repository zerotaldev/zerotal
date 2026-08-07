import { describe, it, expect, afterEach, spyOn, mock } from "bun:test";
import { createApiClient, ApiClientError, ValidationError } from "./index.ts";
import type { ApiRouteMap } from "./index.ts";

interface Routes extends ApiRouteMap {
  "GET /api/users": { query: Record<string, unknown>; response: { data: unknown[] } };
  "GET /api/users/{id}": { params: { id: number }; response: { id: number } };
  "GET /api/report": { response: Blob };
  "POST /api/users": { body: Record<string, unknown>; response: { id: number } };
  "POST /api/avatars": { body: FormData; response: { url: string } };
  "DELETE /api/users/{id}": { params: { id: number }; response: void };
}

// ── Fetch mock ──────────────────────────────────────────────────────────────────
let spy: ReturnType<typeof spyOn>;
function fetchSpy() {
  spy = spyOn(globalThis, "fetch");
  return spy;
}
function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const isJson = body !== undefined && body !== null && typeof body !== "string";
  return new Response(
    body === undefined || body === null ? null : isJson ? JSON.stringify(body) : (body as string),
    {
      status,
      headers: { ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers },
    },
  );
}
function lastInit(): RequestInit {
  const calls = (globalThis.fetch as ReturnType<typeof spyOn>).mock.calls;
  return calls[calls.length - 1]![1] as RequestInit;
}
function lastUrl(): string {
  const calls = (globalThis.fetch as ReturnType<typeof spyOn>).mock.calls;
  return calls[calls.length - 1]![0] as string;
}
afterEach(() => {
  mock.restore();
  delete (globalThis as { document?: unknown }).document;
});

// ── Typed 422 validation errors ──────────────────────────────────────────────────

describe("ValidationError (422)", () => {
  it("parses { message, errors } into a ValidationError", async () => {
    fetchSpy().mockResolvedValueOnce(
      res(422, {
        message: "The given data was invalid.",
        errors: { email: ["The email is invalid.", "Already taken."], name: ["Required."] },
      }),
    );
    const api = createApiClient<Routes>();
    try {
      await api.post("/api/users", { name: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const v = e as ValidationError;
      expect(v.status).toBe(422);
      expect(v.validationMessage).toBe("The given data was invalid.");
      expect(v.has("email")).toBe(true);
      expect(v.first("email")).toBe("The email is invalid.");
      expect(v.fields()).toEqual(["email", "name"]);
      expect(v.all().name).toEqual(["Required."]);
    }
  });

  it("falls back to ApiClientError for a 422 without an errors bag", async () => {
    fetchSpy().mockResolvedValueOnce(res(422, { message: "nope" }));
    const api = createApiClient<Routes>();
    const err = await api.post("/api/users", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it("non-422 errors stay ApiClientError", async () => {
    fetchSpy().mockResolvedValueOnce(res(500, "boom"));
    const api = createApiClient<Routes>();
    const err = await api.get("/api/users/{id}", { id: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).not.toBeInstanceOf(ValidationError);
  });
});

// ── Bodies: FormData / Blob / string ─────────────────────────────────────────────

describe("non-JSON request bodies", () => {
  it("sends FormData untouched (no JSON.stringify, no forced Content-Type)", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { url: "/a.png" }));
    const api = createApiClient<Routes>();
    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "a.png");
    await api.post("/api/avatars", fd);
    const init = lastInit();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("JSON-encodes plain objects with an application/json Content-Type", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { id: 1 }));
    const api = createApiClient<Routes>();
    await api.post("/api/users", { name: "Ada" });
    const init = lastInit();
    expect(init.body).toBe(JSON.stringify({ name: "Ada" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

// ── Downloads / responseType ─────────────────────────────────────────────────────

describe("responseType", () => {
  it("returns a Blob when responseType is 'blob'", async () => {
    fetchSpy().mockResolvedValueOnce(
      res(200, "binary-bytes", { "Content-Type": "application/pdf" }),
    );
    const api = createApiClient<Routes>();
    const blob = await api.get("/api/report", undefined, { responseType: "blob" });
    expect(blob).toBeInstanceOf(Blob);
    expect(await (blob as Blob).text()).toBe("binary-bytes");
  });
});

// ── Nested query serialization ───────────────────────────────────────────────────

describe("nested query serialization", () => {
  it("serializes arrays and nested objects with bracket notation", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { data: [] }));
    const api = createApiClient<Routes>({ baseUrl: "https://api.test" });
    await api.get("/api/users", undefined, {
      query: { ids: [1, 2], filter: { status: "open" }, page: 2 },
    });
    const url = decodeURIComponent(lastUrl());
    expect(url).toContain("ids[]=1");
    expect(url).toContain("ids[]=2");
    expect(url).toContain("filter[status]=open");
    expect(url).toContain("page=2");
  });
});

// ── Timeout + retry ──────────────────────────────────────────────────────────────

describe("timeout", () => {
  it("attaches an abort signal when a timeout is set", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { data: [] }));
    const api = createApiClient<Routes>({ timeout: 5000 });
    await api.get("/api/users");
    expect(lastInit().signal).toBeInstanceOf(AbortSignal);
  });
});

describe("retry policy", () => {
  it("retries idempotent requests on a 5xx and succeeds", async () => {
    const s = fetchSpy();
    s.mockResolvedValueOnce(res(503, "down")).mockResolvedValueOnce(res(200, { id: 1 }));
    const api = createApiClient<Routes>({ retry: { attempts: 2, backoff: () => 0 } });
    const out = await api.get("/api/users/{id}", { id: 1 });
    expect(out).toEqual({ id: 1 });
    expect(s.mock.calls.length).toBe(2);
  });

  it("retries on a network error", async () => {
    const s = fetchSpy();
    s.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(res(200, { id: 1 }));
    const api = createApiClient<Routes>({ retry: { attempts: 1, backoff: () => 0 } });
    await api.get("/api/users/{id}", { id: 1 });
    expect(s.mock.calls.length).toBe(2);
  });

  it("does NOT retry non-idempotent POST by default", async () => {
    const s = fetchSpy();
    s.mockResolvedValueOnce(res(503, "down"));
    const api = createApiClient<Routes>({ retry: { attempts: 3, backoff: () => 0 } });
    await api.post("/api/users", {}).catch(() => {});
    expect(s.mock.calls.length).toBe(1);
  });

  it("does NOT retry a 4xx", async () => {
    const s = fetchSpy();
    s.mockResolvedValueOnce(res(404, "nope"));
    const api = createApiClient<Routes>({ retry: { attempts: 3, backoff: () => 0 } });
    await api.get("/api/users/{id}", { id: 1 }).catch(() => {});
    expect(s.mock.calls.length).toBe(1);
  });

  it("honors Retry-After (passed to backoff)", async () => {
    const s = fetchSpy();
    s.mockResolvedValueOnce(res(429, "slow", { "Retry-After": "2" })).mockResolvedValueOnce(
      res(200, { id: 1 }),
    );
    const seen: (number | null)[] = [];
    const api = createApiClient<Routes>({
      retry: { attempts: 1, backoff: (_a, retryAfterMs) => (seen.push(retryAfterMs), 0) },
    });
    await api.get("/api/users/{id}", { id: 1 });
    expect(seen).toEqual([2000]);
  });
});

// ── Token / CSRF / credentials ──────────────────────────────────────────────────

describe("bearer token", () => {
  it("attaches Authorization from a static token, async resolver, and setToken()", async () => {
    fetchSpy().mockImplementation(async () => res(200, { data: [] }));

    const api = createApiClient<Routes>({ token: "static-1" });
    await api.get("/api/users");
    expect((lastInit().headers as Record<string, string>)["Authorization"]).toBe("Bearer static-1");

    const api2 = createApiClient<Routes>({ token: async () => "async-2" });
    await api2.get("/api/users");
    expect((lastInit().headers as Record<string, string>)["Authorization"]).toBe("Bearer async-2");

    api.setToken("static-3");
    await api.get("/api/users");
    expect((lastInit().headers as Record<string, string>)["Authorization"]).toBe("Bearer static-3");
  });

  it("does not override an explicit Authorization header", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { data: [] }));
    const api = createApiClient<Routes>({ token: "x" });
    await api.get("/api/users", undefined, { headers: { Authorization: "Bearer override" } });
    expect((lastInit().headers as Record<string, string>)["Authorization"]).toBe("Bearer override");
  });
});

describe("CSRF / credentials", () => {
  it("sends the decoded XSRF-TOKEN cookie as X-XSRF-TOKEN on mutating requests", async () => {
    (globalThis as { document?: { cookie: string } }).document = { cookie: "XSRF-TOKEN=tok%3Dval" };
    fetchSpy().mockImplementation(async () => res(200, { id: 1 }));
    const api = createApiClient<Routes>({ withCredentials: true });

    await api.post("/api/users", {});
    expect((lastInit().headers as Record<string, string>)["X-XSRF-TOKEN"]).toBe("tok=val");
    expect(lastInit().credentials).toBe("include");

    await api.get("/api/users"); // GET → no CSRF header
    expect((lastInit().headers as Record<string, string>)["X-XSRF-TOKEN"]).toBeUndefined();
  });

  it("supports custom cookie/header names", async () => {
    (globalThis as { document?: { cookie: string } }).document = { cookie: "csrf=abc" };
    fetchSpy().mockResolvedValueOnce(res(200, { id: 1 }));
    const api = createApiClient<Routes>({ csrf: { cookie: "csrf", header: "X-CSRF" } });
    await api.delete("/api/users/{id}", { id: 1 });
    expect((lastInit().headers as Record<string, string>)["X-CSRF"]).toBe("abc");
  });
});

// ── Hooks ────────────────────────────────────────────────────────────────────────

describe("onForbidden + meta", () => {
  it("calls onForbidden (and onError) on a 403", async () => {
    fetchSpy().mockResolvedValueOnce(res(403, "nope"));
    let forbidden = false;
    let errored = false;
    const api = createApiClient<Routes>({
      onForbidden: () => void (forbidden = true),
      onError: () => void (errored = true),
    });
    await api.get("/api/users").catch(() => {});
    expect(forbidden).toBe(true);
    expect(errored).toBe(true);
  });

  it("invokes the per-request meta callback with status + headers", async () => {
    fetchSpy().mockResolvedValueOnce(res(200, { data: [] }, { "X-Total": "42" }));
    const api = createApiClient<Routes>();
    let total: string | null = null;
    await api.get("/api/users", undefined, {
      meta: (m) => {
        total = m.headers.get("X-Total");
      },
    });
    expect(total).toBe("42");
  });
});
