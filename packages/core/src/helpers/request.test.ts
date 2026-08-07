import { describe, it, expect } from "bun:test";
import { HttpContext, RequestContext } from "@zerotal/core";
import { request } from "./request.ts";

function inRequest<T>(ctx: HttpContext, fn: () => T): T {
  return RequestContext.run(ctx, fn);
}

describe("request()", () => {
  it("returns the current HttpContext when called with no args", () => {
    const ctx = HttpContext.fake("http://localhost/");
    const result = inRequest(ctx, () => request());
    expect(result).toBe(ctx);
  });

  it("reads a query param when called with a key", () => {
    const ctx = HttpContext.fake("http://localhost/?next=%2Fdashboard");
    expect(inRequest(ctx, () => request("next"))).toBe("/dashboard");
  });

  it("reads a route param (higher priority than query)", () => {
    const ctx = HttpContext.fake("http://localhost/posts/7?id=99");
    ctx.params = { id: "7" };
    expect(inRequest(ctx, () => request("id"))).toBe("7");
  });

  it("returns the fallback when key is absent", () => {
    const ctx = HttpContext.fake("http://localhost/");
    expect(inRequest(ctx, () => request("page", "1"))).toBe("1");
    expect(inRequest(ctx, () => request("page"))).toBeUndefined();
  });

  it("reads cached body data", async () => {
    const ctx = HttpContext.fake("http://localhost/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    await ctx.body(); // prime cache
    expect(inRequest(ctx, () => request("email"))).toBe("alice@example.com");
  });

  it("throws outside a request context", () => {
    expect(() => request()).toThrow();
  });
});
