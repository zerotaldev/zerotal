import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { HttpContext, RequestContext, WebhookMiddleware } from "@zerotal/core";
import { validate } from "./validate.ts";
import { FormRequest } from "./FormRequest.ts";
import type { RuleBuilder } from "./RuleBuilder.ts";
import { ValidationJsonError, ValidationRedirectError } from "./ValidationError.ts";

/**
 * The validator and `ctx.body()` read one body.
 *
 * A request body is a stream and can be read once. Both validators read it straight off
 * `ctx.request`, past the context's cache, so each consumed it for the other: a route that
 * awaited `ctx.body()` first had a valid body fail validation as empty, `ctx.body()` after a
 * validation returned `{}`, and a body read by `WebhookMiddleware` was invisible to the rules.
 */

const json = (body: unknown, headers: Record<string, string> = {}) =>
  HttpContext.fake("http://localhost/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });

const form = (fields: Record<string, string>) =>
  HttpContext.fake("http://localhost/items", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  });

class StoreItemRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return { name: r.string() };
  }
}

describe("validate() after ctx.body()", () => {
  it("sees the JSON body ctx.body() already read", async () => {
    const ctx = json({ name: "Alice" });
    await ctx.body();
    const data = await validate(ctx, (r) => ({ name: r.string() }));
    expect(data).toEqual({ name: "Alice" });
  });

  it("sees the form body ctx.body() already read", async () => {
    const ctx = form({ name: "Alice" });
    await ctx.body();
    const data = await validate(ctx, (r) => ({ name: r.string() }));
    expect(data).toEqual({ name: "Alice" });
  });

  it("holds for FormRequest too", async () => {
    const ctx = json({ name: "Alice" });
    await ctx.body();
    const data = await RequestContext.run(ctx, () => StoreItemRequest.validate());
    expect(data).toEqual({ name: "Alice" });
  });
});

describe("ctx.body() and ctx.input() after validate()", () => {
  it("return the raw body, not the validated subset", async () => {
    const ctx = json({ name: "Alice", note: "not in the rules" });
    await validate(ctx, (r) => ({ name: r.string() }));
    expect(await ctx.body()).toEqual({ name: "Alice", note: "not in the rules" });
    expect(ctx.input("name")).toBe("Alice");
    expect(ctx.input("note")).toBe("not in the rules");
  });

  it("return a form's fields", async () => {
    const ctx = form({ name: "Alice" });
    await validate(ctx, (r) => ({ name: r.string() }));
    expect(await ctx.body()).toEqual({ name: "Alice" });
    expect(ctx.input("name")).toBe("Alice");
  });

  it("hold for FormRequest too", async () => {
    const ctx = json({ name: "Alice", note: "kept" });
    await RequestContext.run(ctx, () => StoreItemRequest.validate());
    expect(await ctx.body()).toEqual({ name: "Alice", note: "kept" });
    expect(ctx.input("name")).toBe("Alice");
  });

  it("leave the query string out of the body on a GET", async () => {
    const ctx = HttpContext.fake("http://localhost/search?q=reno", {
      headers: { Accept: "application/json" },
    });
    expect(await validate(ctx, (r) => ({ q: r.string() }))).toEqual({ q: "reno" });
    expect(await ctx.body()).toEqual({});
  });
});

// The validator reads through ctx.body(), so whatever JSON value the client sent is what the
// context caches. A bare 5 or null cached as is made the ctx.input() after a passing validation
// throw evaluating `key in 5`: a 500 for a route whose fields are all optional.
describe("ctx.input() after validate() on a JSON body that is not an object", () => {
  const send = (raw: string) =>
    HttpContext.fake("http://localhost/items?q=fromquery", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: raw,
    });

  for (const raw of ["5", '"str"', "null", "[]", "[1,2]"]) {
    it(`falls back to the query for ${raw}`, async () => {
      const ctx = send(raw);
      const data: unknown = await validate(ctx, (r) => ({ name: r.string().optional() }));
      expect(data).toEqual({});
      expect(ctx.input("q")).toBe("fromquery");
      expect(ctx.input("name", "fallback")).toBe("fallback");
    });
  }

  it("holds for FormRequest too", async () => {
    class OptionalNameRequest extends FormRequest {
      rules(r: RuleBuilder) {
        return { name: r.string().optional() };
      }
    }
    const ctx = send("5");
    const data: unknown = await RequestContext.run(ctx, () => OptionalNameRequest.validate());
    expect(data).toEqual({});
    expect(ctx.input("q")).toBe("fromquery");
  });

  it("reads an object body's fields as before", async () => {
    const ctx = send(JSON.stringify({ name: "Alice", q: "frombody" }));
    expect(await validate(ctx, (r) => ({ name: r.string().optional() }))).toEqual({
      name: "Alice",
    });
    expect(ctx.input("name")).toBe("Alice");
    expect(ctx.input("q")).toBe("frombody");
  });
});

describe("validate() after WebhookMiddleware", () => {
  it("sees the body the middleware read to check the signature", async () => {
    const secret = "webhook-secret";
    const raw = JSON.stringify({ event: "invoice.paid", amount: 120 });
    const ctx = json(
      { event: "invoice.paid", amount: 120 },
      { "x-webhook-signature": createHmac("sha256", secret).update(raw).digest("hex") },
    );

    let data: unknown;
    const result = await new WebhookMiddleware({ secret }).handle(ctx, async () => {
      data = await validate(ctx, (r) => ({ event: r.string(), amount: r.number() }));
    });

    expect(result).toBeUndefined();
    expect(data).toEqual({ event: "invoice.paid", amount: 120 });
  });
});

describe("a multipart body keeps its uploads", () => {
  const upload = () => {
    const body = new FormData();
    body.append("title", "Receipt");
    body.append("scan", new File(["%PDF-1.7"], "scan.pdf", { type: "application/pdf" }));
    return HttpContext.fake("http://localhost/receipts", {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
    });
  };

  it("validates the file field and leaves it for ctx.file()", async () => {
    const ctx = upload();
    const data = await validate(ctx, (r) => ({ title: r.string(), scan: r.file() }));
    expect(data.title).toBe("Receipt");
    expect(data.scan).toBeInstanceOf(File);
    expect((await ctx.file("scan"))?.originalName).toBe("scan.pdf");
    expect(await ctx.body()).toEqual({ title: "Receipt" });
  });

  it("validates the file field after ctx.body() read the form", async () => {
    const ctx = upload();
    await ctx.body();
    const data = await validate(ctx, (r) => ({ title: r.string(), scan: r.file() }));
    expect(data.scan).toBeInstanceOf(File);
  });
});

/**
 * A context built by hand: a plain object with a request and none of the context's readers. Apps
 * fake one in their own tests, and the validator read such a context before it shared the body
 * cache, so it still reads one, straight off the request.
 */
describe("a hand-built context", () => {
  const plain = (request: Request) => ({ request }) as unknown as HttpContext;

  it("validate() reads a JSON body off the request", async () => {
    const ctx = plain(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      }),
    );
    expect(await validate(ctx, (r) => ({ name: r.string() }))).toEqual({ name: "Alice" });
  });

  it("validate() reads a form body and answers a JSON client with a JSON error", async () => {
    const ctx = plain(
      new Request("http://localhost/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ title: "no name" }).toString(),
      }),
    );
    const error = await validate(ctx, (r) => ({ name: r.string(), title: r.string() })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationJsonError);
    expect(Object.keys((error as ValidationJsonError).errors)).toEqual(["name"]);
  });

  // A failed form redirects back to the Referer when it is on the request's own origin. The
  // origin came from `ctx.url`, which a hand-built context does not have, so a failing form
  // threw a TypeError instead of redirecting.
  const failingForm = (referer: string) =>
    plain(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: referer },
        body: new URLSearchParams({ title: "no name" }).toString(),
      }),
    );

  it("validate() redirects a failing form back, by the request's own origin", async () => {
    for (const [referer, back] of [
      ["http://localhost/items/new", "http://localhost/items/new"],
      ["https://evil.example/phish", "/"],
    ]) {
      const error = await validate(failingForm(referer!), (r) => ({ name: r.string() })).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ValidationRedirectError);
      expect((error as ValidationRedirectError).redirectTo).toBe(back!);
    }
  });

  it("FormRequest redirects a failing form back, by the request's own origin", async () => {
    const ctx = failingForm("http://localhost/items/new");
    const error = await RequestContext.run(ctx, () => StoreItemRequest.validate()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationRedirectError);
    expect((error as ValidationRedirectError).redirectTo).toBe("http://localhost/items/new");
  });

  it("FormRequest reads the body off the request too", async () => {
    const ctx = plain(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      }),
    );
    expect(await RequestContext.run(ctx, () => StoreItemRequest.validate())).toEqual({
      name: "Alice",
    });
  });
});
