import { describe, it, expect } from "bun:test";
import { HttpContext, RequestContext } from "@zerotal/core";
import { FormRequest } from "./FormRequest.ts";
import { RuleBuilder } from "./RuleBuilder.ts";

// ── Test subclasses ───────────────────────────────────────────────────────────

class StorePostRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3),
      body: r.string().min(10),
    };
  }
}

class AuthOnlyRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return { name: r.string() };
  }
  override authorize(): boolean {
    return false;
  }
}

class AuthCtxRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return { name: r.string() };
  }
  override authorize(): boolean {
    return !!this.context.user;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(
  overrides: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    isJson?: boolean;
    isInertia?: boolean;
    user?: { id: number };
  } = {},
) {
  const { body = {}, isJson = true, isInertia = false } = overrides;

  const extraHeaders = overrides.headers ?? {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(isJson ? { Accept: "application/json" } : {}),
    ...(isInertia ? { "X-Inertia": "true", Referer: "/" } : {}),
    ...extraHeaders,
  };

  const ctx = HttpContext.fake("http://localhost/posts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (overrides.user) Object.assign(ctx, { user: overrides.user });
  return ctx;
}

/** A form-urlencoded POST, the shape a plain HTML form sends. */
function formPost(fields: Record<string, string>) {
  return HttpContext.fake("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Run a validate() call inside an ALS-backed request context. */
function withCtx<T>(ctx: HttpContext, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(ctx, fn);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FormRequest.validate()", () => {
  it("returns validated data for a valid request", async () => {
    const ctx = makeCtx({ body: { title: "Hello Zerotal", body: "Long enough body here" } });
    const data = await withCtx(ctx, () => StorePostRequest.validate());
    expect(data.title).toBe("Hello Zerotal");
    expect(data.body).toBe("Long enough body here");
  });

  it("infers concrete field types — title and body are string, not unknown", async () => {
    const ctx = makeCtx({ body: { title: "Hello Zerotal", body: "Long enough body here" } });
    const data = await withCtx(ctx, () => StorePostRequest.validate());
    // TypeScript must accept these without casts — compile-time test
    const title: string = data.title;
    const body: string = data.body;
    expect(title).toBe("Hello Zerotal");
    expect(body).toBe("Long enough body here");
  });

  it("throws ValidationJsonError for invalid JSON API input", async () => {
    const ctx = makeCtx({ body: { title: "Hi", body: "short" }, isJson: true });
    let err: unknown;
    try {
      await withCtx(ctx, () => StorePostRequest.validate());
    } catch (e) {
      err = e;
    }
    expect((err as { name: string }).name).toBe("ValidationJsonError");
  });

  it("throws ValidationRedirectError for Inertia/form request", async () => {
    const ctx = makeCtx({
      body: { title: "Hi", body: "short" },
      isJson: false,
      isInertia: true,
    });
    let err: unknown;
    try {
      await withCtx(ctx, () => StorePostRequest.validate());
    } catch (e) {
      err = e;
    }
    expect((err as { name: string }).name).toBe("ValidationRedirectError");
  });

  it("throws ForbiddenError (403) when authorize() returns false", async () => {
    const ctx = makeCtx({ body: { name: "Alice" } });
    let err: unknown;
    try {
      await withCtx(ctx, () => AuthOnlyRequest.validate());
    } catch (e) {
      err = e;
    }
    expect((err as { name: string }).name).toBe("ForbiddenError");
    expect((err as { status: number }).status).toBe(403);
  });

  it("stores errors and old input in session on failure", async () => {
    const stored: Record<string, unknown> = {};
    const ctx = makeCtx({ body: { title: "Hi", body: "short" }, isJson: false });
    (
      ctx as unknown as { session: { set(k: string, v: unknown): void; forget(k: string): void } }
    ).session = {
      set: (k, v) => {
        stored[k] = v;
      },
      forget: () => {},
    };
    try {
      await withCtx(ctx, () => StorePostRequest.validate());
    } catch {
      /* expected */
    }
    expect(stored["errors"]).toBeDefined();
    expect(stored["old"]).toBeDefined();
  });

  it("clears errors from session on success", async () => {
    const forgotten: string[] = [];
    const ctx = makeCtx({ body: { title: "Hello Zerotal", body: "Long enough body here" } });
    (
      ctx as unknown as { session: { set(k: string, v: unknown): void; forget(k: string): void } }
    ).session = {
      set: () => {},
      forget: (k) => {
        forgotten.push(k);
      },
    };
    await withCtx(ctx, () => StorePostRequest.validate());
    expect(forgotten).toContain("errors");
    expect(forgotten).toContain("old");
  });

  it("authorize() can access this.context to inspect user", async () => {
    const ctx = makeCtx({ body: { name: "Alice" }, user: { id: 1 } });
    const data = await withCtx(ctx, () => AuthCtxRequest.validate());
    expect(data.name).toBe("Alice");
  });

  it("authorize() rejects with ForbiddenError when this.context.user is absent", async () => {
    const ctx = makeCtx({ body: { name: "Alice" } });
    let err: unknown;
    try {
      await withCtx(ctx, () => AuthCtxRequest.validate());
    } catch (e) {
      err = e;
    }
    expect((err as { name: string }).name).toBe("ForbiddenError");
    expect((err as { status: number }).status).toBe(403);
  });
});

// ── Form-urlencoded / multipart body parsing ──────────────────────────────────

class ShortFormRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return { name: r.string().min(2) };
  }
}

describe("FormRequest.validate() — form-urlencoded body", () => {
  it("parses application/x-www-form-urlencoded body", async () => {
    const ctx = formPost({ name: "Alice" });

    const data = await withCtx(ctx, () => ShortFormRequest.validate());
    expect((data as any).name).toBe("Alice");
  });

  it("falls back to empty body when body parsing throws", async () => {
    const ctx = HttpContext.fake("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{bad json",
    });

    let err: unknown;
    try {
      await withCtx(ctx, () => ShortFormRequest.validate());
    } catch (e) {
      err = e;
    }
    // name is missing (body was empty due to parse error), so validation fails
    expect((err as { name: string }).name).toBe("ValidationJsonError");
  });
});

// ── prepareForValidation ──────────────────────────────────────────────────────

/**
 * The hook that reconciles what a browser can send with what the rules require.
 *
 * The case it exists for: an unselected `<select>` posts `""`, and HTML has no
 * way to say `null`. Without the hook a `nullable()` number field is only
 * satisfiable from a client that can rewrite the body before posting — which
 * makes the rule unreachable from a plain `<form method="post">`.
 */
class NullableSelectRequest extends FormRequest {
  override prepareForValidation(body: Record<string, unknown>) {
    if (body["assigneeId"] === "") body["assigneeId"] = null;
    return body;
  }

  rules(r: RuleBuilder) {
    return { assigneeId: r.number().optional().nullable() };
  }
}

describe("FormRequest.prepareForValidation()", () => {
  it("normalises the body before the rules run", async () => {
    // Two bugs met here. Without the hook, `""` fails `number()` and the form
    // bounces; and until `optional().nullable()` was fixed to let an explicit
    // null through, the value arrived as `undefined` — which `fill()` reads as
    // "leave this column", so "unassign" saved nothing and still said it had.
    const data = await withCtx(formPost({ assigneeId: "" }), () =>
      NullableSelectRequest.validate(),
    );
    expect((data as any).assigneeId).toBeNull();
  });

  it("leaves a real value alone", async () => {
    const data = await withCtx(formPost({ assigneeId: "7" }), () =>
      NullableSelectRequest.validate(),
    );
    expect((data as any).assigneeId).toBe(7);
  });

  it("defaults to identity, so an unhooked request is unaffected", async () => {
    const data = await withCtx(formPost({ name: "Alice" }), () => ShortFormRequest.validate());
    expect((data as any).name).toBe("Alice");
  });
});

// ── GET request — query param body merging ────────────────────────────────────

describe("FormRequest.validate() — GET with query params", () => {
  it("merges query string params into body for GET requests", async () => {
    const ctx = HttpContext.fake("http://localhost/test?name=Bob", {
      headers: { Accept: "application/json" },
    });

    const data = await withCtx(ctx, () => ShortFormRequest.validate());
    expect((data as any).name).toBe("Bob");
  });
});
