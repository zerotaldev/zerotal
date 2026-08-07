import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { createApiClient, ApiClientError } from "./index.ts";
import type { ApiRouteMap } from "./index.ts";

// ── Test route map ────────────────────────────────────────────────────────────

interface UserResource {
  id: number;
  name: string;
  email: string;
}
interface PostResource {
  id: number;
  title: string;
  userId: number;
}

interface Routes extends ApiRouteMap {
  "GET /api/users": {
    query: { page?: number; perPage?: number };
    response: { data: UserResource[]; total: number };
  };
  "GET /api/users/{id}": {
    params: { id: string | number };
    response: UserResource;
  };
  "POST /api/users": {
    body: { name: string; email: string };
    response: UserResource;
  };
  "PUT /api/users/{id}": {
    body: { name?: string; email?: string };
    response: UserResource;
  };
  "PATCH /api/users/{id}": {
    body: { name?: string };
    response: UserResource;
  };
  "DELETE /api/users/{id}": {
    params: { id: string | number };
    response: void;
  };
  "GET /api/posts/{postId}/comments": {
    params: { postId: number };
    response: { data: PostResource[] };
  };
}

// ── Mock fetch helper ─────────────────────────────────────────────────────────

let _fetchSpy: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  mock.restore();
  _fetchSpy = null;
});

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}): void {
  _fetchSpy = spyOn(globalThis, "fetch");
  _fetchSpy.mockResolvedValueOnce(
    new Response(body !== undefined && body !== null ? JSON.stringify(body) : null, {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}

function captureFetch(): { url: string; init: RequestInit } {
  const calls = (_fetchSpy ?? (globalThis.fetch as ReturnType<typeof spyOn>)).mock.calls;
  const last = calls[calls.length - 1]!;
  return { url: last[0] as string, init: last[1] as RequestInit };
}

// ── createApiClient ───────────────────────────────────────────────────────────

describe("createApiClient", () => {
  it("returns an ApiClient instance", () => {
    const api = createApiClient<Routes>();
    expect(api).toBeDefined();
    expect(typeof api.get).toBe("function");
    expect(typeof api.post).toBe("function");
  });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe("api.get()", () => {
  beforeEach(() => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  });

  it("sends GET to the correct URL", async () => {
    const api = createApiClient<Routes>({ baseUrl: "https://api.test" });
    mockFetch(200, { id: 1, name: "Alice", email: "alice@test.com" });
    await api.get("/api/users/{id}", { id: 1 });
    const { url, init } = captureFetch();
    expect(url).toBe("https://api.test/api/users/1");
    expect(init.method).toBe("GET");
  });

  it("interpolates multiple path params", async () => {
    const api = createApiClient<Routes>({ baseUrl: "https://api.test" });
    mockFetch(200, { data: [] });
    await api.get("/api/posts/{postId}/comments", { postId: 42 });
    const { url } = captureFetch();
    expect(url).toBe("https://api.test/api/posts/42/comments");
  });

  it("appends query string params", async () => {
    const api = createApiClient<Routes>({ baseUrl: "https://api.test" });
    mockFetch(200, { data: [], total: 0 });
    await api.get("/api/users", undefined, { query: { page: 2, perPage: 15 } });
    const { url } = captureFetch();
    expect(url).toContain("page=2");
    expect(url).toContain("perPage=15");
  });

  it("returns the parsed JSON response", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    const payload = { id: 5, name: "Eve", email: "eve@test.com" };
    mockFetch(200, payload);
    const user = await api.get("/api/users/{id}", { id: 5 });
    expect(user).toEqual(payload);
  });

  it("merges default headers", async () => {
    const api = createApiClient<Routes>({ headers: { "X-Custom": "yes" } });
    mockFetch(200, {});
    await api.get("/api/users", undefined);
    const { init } = captureFetch();
    expect((init.headers as Record<string, string>)["X-Custom"]).toBe("yes");
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("api.post()", () => {
  it("sends POST with JSON body", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    const created = { id: 10, name: "New", email: "new@test.com" };
    mockFetch(201, created);
    const result = await api.post("/api/users", { name: "New", email: "new@test.com" });
    const { init } = captureFetch();
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "New", email: "new@test.com" });
    expect(result).toEqual(created);
  });

  it("sets Content-Type: application/json on body requests", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    mockFetch(201, {});
    await api.post("/api/users", { name: "X", email: "x@x.com" });
    const { init } = captureFetch();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

// ── PUT / PATCH ───────────────────────────────────────────────────────────────

describe("api.put() / api.patch()", () => {
  it("put() sends PUT", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    mockFetch(200, { id: 1, name: "Updated", email: "a@b.com" });
    await api.put("/api/users/{id}", { name: "Updated" }, { params: { id: 1 } });
    const { init } = captureFetch();
    expect(init.method).toBe("PUT");
  });

  it("patch() sends PATCH", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    mockFetch(200, { id: 1, name: "Patched", email: "a@b.com" });
    await api.patch("/api/users/{id}", { name: "Patched" }, { params: { id: 1 } });
    const { init } = captureFetch();
    expect(init.method).toBe("PATCH");
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe("api.delete()", () => {
  it("sends DELETE to the interpolated URL", async () => {
    const api = createApiClient<Routes>({ baseUrl: "https://api.test" });
    mockFetch(204, null, { "content-length": "0" });
    await api.delete("/api/users/{id}", { id: 7 });
    const { url, init } = captureFetch();
    expect(url).toBe("https://api.test/api/users/7");
    expect(init.method).toBe("DELETE");
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("ApiClientError", () => {
  it("throws ApiClientError on non-2xx", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toBeInstanceOf(ApiClientError);
  });

  it("includes the status code on the error", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );
    let err: ApiClientError | undefined;
    try {
      await api.get("/api/users/{id}", { id: 99 });
    } catch (e) {
      err = e as ApiClientError;
    }
    expect(err?.status).toBe(404);
  });

  it("calls onError callback before throwing", async () => {
    const caught: ApiClientError[] = [];
    const api = createApiClient<Routes>({ onError: (e) => caught.push(e) });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toThrow();
    expect(caught).toHaveLength(1);
    expect(caught[0]!.status).toBe(500);
  });

  it("throws when path param is missing at runtime", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    await expect(
      // @ts-expect-error — deliberately omitting required id at runtime
      api.get("/api/users/{id}", {}),
    ).rejects.toThrow("Missing path parameter");
  });
});

// ── TypeScript type system smoke test (compile-time only) ─────────────────────

describe("Type inference (runtime smoke test)", () => {
  it("response type flows through", async () => {
    const api = createApiClient<Routes>({ baseUrl: "" });
    mockFetch(200, { id: 1, name: "T", email: "t@t.com" });

    // This is a runtime test that checks the value; TypeScript type is checked at compile time
    const result = await api.get("/api/users/{id}", { id: 1 });
    // If TypeScript types are wrong, the linter would catch it — here we just verify runtime
    expect(result).toBeDefined();
  });
});

// ── onRequest interceptors ────────────────────────────────────────────────────

describe("onRequest interceptor", () => {
  it("interceptor can add a header to every request", async () => {
    const api = createApiClient<Routes>({
      onRequest: (cfg) => ({
        ...cfg,
        headers: { ...cfg.headers, "X-Intercepted": "yes" },
      }),
    });
    mockFetch(200, { id: 1, name: "A", email: "a@a.com" });
    await api.get("/api/users/{id}", { id: 1 });
    const { init } = captureFetch();
    expect((init.headers as Record<string, string>)["X-Intercepted"]).toBe("yes");
  });

  it("interceptor can mutate the URL", async () => {
    const api = createApiClient<Routes>({
      baseUrl: "https://api.test",
      onRequest: (cfg) => ({ ...cfg, url: cfg.url + "?locale=en" }),
    });
    mockFetch(200, { data: [], total: 0 });
    await api.get("/api/users", undefined);
    const { url } = captureFetch();
    expect(url).toContain("locale=en");
  });

  it("async interceptor is awaited before fetch", async () => {
    let called = false;
    const api = createApiClient<Routes>({
      onRequest: async (cfg) => {
        await Promise.resolve();
        called = true;
        return cfg;
      },
    });
    mockFetch(200, {});
    await api.get("/api/users", undefined);
    expect(called).toBe(true);
  });

  it("multiple interceptors run in declaration order", async () => {
    const order: number[] = [];
    const api = createApiClient<Routes>({
      onRequest: [
        (cfg) => {
          order.push(1);
          return cfg;
        },
        (cfg) => {
          order.push(2);
          return cfg;
        },
        (cfg) => {
          order.push(3);
          return cfg;
        },
      ],
    });
    mockFetch(200, {});
    await api.get("/api/users", undefined);
    expect(order).toEqual([1, 2, 3]);
  });

  it("interceptor headers are merged with per-request headers", async () => {
    const api = createApiClient<Routes>({
      onRequest: (cfg) => ({
        ...cfg,
        headers: { ...cfg.headers, "X-From-Interceptor": "yes" },
      }),
    });
    mockFetch(200, {});
    await api.get("/api/users", undefined, { headers: { "X-Per-Request": "also" } });
    const { init } = captureFetch();
    const h = init.headers as Record<string, string>;
    expect(h["X-From-Interceptor"]).toBe("yes");
    expect(h["X-Per-Request"]).toBe("also");
  });
});

// ── onUnauthorized ────────────────────────────────────────────────────────────

describe("onUnauthorized handler", () => {
  it("is called on 401 responses", async () => {
    let called = false;
    const api = createApiClient<Routes>({
      onUnauthorized: async (_err, retry) => {
        called = true;
        return retry();
      },
    });
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, name: "A", email: "a@a.com" }), { status: 200 }),
      );

    await api.get("/api/users/{id}", { id: 1 });
    expect(called).toBe(true);
  });

  it("retry re-sends the original request", async () => {
    let callCount = 0;
    const api = createApiClient<Routes>({
      onUnauthorized: (_err, retry) => retry(),
    });
    spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1)
        return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
      return new Response(JSON.stringify({ id: 2, name: "B", email: "b@b.com" }), { status: 200 });
    });

    const result = await api.get("/api/users/{id}", { id: 2 });
    expect(callCount).toBe(2);
    expect(result.id).toBe(2);
  });

  it("retry merges header overrides into the retried request", async () => {
    const capturedInits: RequestInit[] = [];
    const api = createApiClient<Routes>({
      onUnauthorized: (_err, retry) => retry({ Authorization: "Bearer newtoken" }),
    });
    spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedInits.push(init!);
      if (capturedInits.length === 1)
        return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
      return new Response(JSON.stringify({ id: 3, name: "C", email: "c@c.com" }), { status: 200 });
    });

    await api.get("/api/users/{id}", { id: 3 });
    expect(capturedInits).toHaveLength(2);
    const retryInit = capturedInits[1]!;
    expect((retryInit.headers as Record<string, string>)["Authorization"]).toBe("Bearer newtoken");
  });

  it("retry request also passes through onRequest interceptors", async () => {
    let interceptCount = 0;
    const api = createApiClient<Routes>({
      onRequest: (cfg) => {
        interceptCount++;
        return cfg;
      },
      onUnauthorized: (_err, retry) => retry(),
    });
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await api.get("/api/users", undefined);
    expect(interceptCount).toBe(2); // original + retry
  });

  it("does not retry again on a second 401 (no infinite loop)", async () => {
    let unauthorizedCount = 0;
    const api = createApiClient<Routes>({
      onUnauthorized: async (_err, retry) => {
        unauthorizedCount++;
        return retry();
      },
    });
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toBeInstanceOf(ApiClientError);
    expect(unauthorizedCount).toBe(1); // called once, retry also 401 → throws, no second call
  });

  it("is not called for non-401 errors", async () => {
    let called = false;
    const api = createApiClient<Routes>({
      onUnauthorized: async (_err, retry) => {
        called = true;
        return retry();
      },
    });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );
    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("onError is still called after a failed retry", async () => {
    const errors: ApiClientError[] = [];
    const api = createApiClient<Routes>({
      onError: (e) => errors.push(e),
      onUnauthorized: (_err, retry) => retry(),
    });
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toThrow();
    expect(errors).toHaveLength(1); // once after the failed retry
  });
});

// ── onError (async) ───────────────────────────────────────────────────────────

describe("onError (async)", () => {
  it("awaits an async onError handler before throwing", async () => {
    const log: number[] = [];
    const api = createApiClient<Routes>({
      onError: async (e) => {
        await Promise.resolve();
        log.push(e.status);
      },
    });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toThrow();
    // If the await is missing the log would still be empty when the error is thrown
    expect(log).toEqual([500]);
  });
});

// ── onResponse interceptors ───────────────────────────────────────────────────

describe("onResponse interceptor", () => {
  it("can transform the response data", async () => {
    const api = createApiClient<Routes>({
      onResponse: (ctx) => ({ ...ctx, data: { ...(ctx.data as object), injected: true } }),
    });
    mockFetch(200, { id: 1, name: "A", email: "a@a.com" });
    const result = await api.get("/api/users/{id}", { id: 1 });
    expect((result as unknown as Record<string, unknown>)["injected"]).toBe(true);
  });

  it("receives the HTTP status and response headers", async () => {
    let capturedCtx: import("./index.ts").ResponseContext | undefined;
    const api = createApiClient<Routes>({
      onResponse: (ctx) => {
        capturedCtx = ctx;
        return ctx;
      },
    });
    mockFetch(200, { id: 1, name: "A", email: "a@a.com" });
    await api.get("/api/users/{id}", { id: 1 });
    expect(capturedCtx?.status).toBe(200);
    expect(capturedCtx?.headers).toBeInstanceOf(Headers);
  });

  it("async interceptor is awaited", async () => {
    let called = false;
    const api = createApiClient<Routes>({
      onResponse: async (ctx) => {
        await Promise.resolve();
        called = true;
        return ctx;
      },
    });
    mockFetch(200, {});
    await api.get("/api/users", undefined);
    expect(called).toBe(true);
  });

  it("multiple interceptors run in declaration order", async () => {
    const order: number[] = [];
    const api = createApiClient<Routes>({
      onResponse: [
        (ctx) => {
          order.push(1);
          return ctx;
        },
        (ctx) => {
          order.push(2);
          return ctx;
        },
        (ctx) => {
          order.push(3);
          return ctx;
        },
      ],
    });
    mockFetch(200, {});
    await api.get("/api/users", undefined);
    expect(order).toEqual([1, 2, 3]);
  });

  it("receives the final request config (after onRequest interceptors)", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const api = createApiClient<Routes>({
      onRequest: (cfg) => ({ ...cfg, headers: { ...cfg.headers, "X-Added": "yes" } }),
      onResponse: (ctx) => {
        capturedHeaders = ctx.request.headers;
        return ctx;
      },
    });
    mockFetch(200, { id: 1, name: "A", email: "a@a.com" });
    await api.get("/api/users/{id}", { id: 1 });
    expect(capturedHeaders?.["X-Added"]).toBe("yes");
  });

  it("is NOT called on error responses", async () => {
    let called = false;
    const api = createApiClient<Routes>({
      onResponse: (ctx) => {
        called = true;
        return ctx;
      },
    });
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(api.get("/api/users/{id}", { id: 1 })).rejects.toBeInstanceOf(ApiClientError);
    expect(called).toBe(false);
  });

  it("can unwrap a common { data: T } API envelope", async () => {
    interface EnvelopedRoutes extends ApiRouteMap {
      "GET /api/users": { response: UserResource[] };
    }
    const api = createApiClient<EnvelopedRoutes>({
      onResponse: (ctx) => ({
        ...ctx,
        data:
          ctx.data !== undefined ? ((ctx.data as { data?: unknown }).data ?? ctx.data) : ctx.data,
      }),
    });
    mockFetch(200, { data: [{ id: 1, name: "A", email: "a@a.com" }] });
    const users = await api.get("/api/users");
    expect(Array.isArray(users)).toBe(true);
    expect(users[0]?.id).toBe(1);
  });

  it("is called for 204 responses with data: undefined", async () => {
    let capturedStatus: number | undefined;
    let capturedData: unknown = "not-set";
    const api = createApiClient<Routes>({
      onResponse: (ctx) => {
        capturedStatus = ctx.status;
        capturedData = ctx.data;
        return ctx;
      },
    });
    mockFetch(204, null, { "content-length": "0" });
    await api.delete("/api/users/{id}", { id: 1 });
    expect(capturedStatus).toBe(204);
    expect(capturedData).toBeUndefined();
  });
});
