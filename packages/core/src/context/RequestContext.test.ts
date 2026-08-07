import { describe, it, expect } from "bun:test";
import { RequestContext } from "./RequestContext.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";

describe("RequestContext", () => {
  it("throws outside of run()", () => {
    expect(() => RequestContext.get()).toThrow();
  });

  it("returns undefined from tryGet() outside of run()", () => {
    expect(RequestContext.tryGet()).toBeUndefined();
  });

  it("returns context inside run()", async () => {
    const ctx = HttpContext.fake();
    await RequestContext.run(ctx, async () => {
      expect(RequestContext.get()).toBe(ctx);
    });
  });

  it("tryGet() returns the context inside run()", () => {
    const ctx = HttpContext.fake();
    RequestContext.run(ctx, () => {
      expect(RequestContext.tryGet()).toBe(ctx);
    });
  });

  it("request() shortcut returns the Request object", () => {
    const ctx = HttpContext.fake("http://localhost/test");
    RequestContext.run(ctx, () => {
      expect(RequestContext.request()).toBeInstanceOf(Request);
      expect(RequestContext.request().url).toBe("http://localhost/test");
    });
  });

  it("requestId() returns a non-empty string", () => {
    const ctx = HttpContext.fake();
    RequestContext.run(ctx, () => {
      expect(typeof RequestContext.requestId()).toBe("string");
      expect(RequestContext.requestId().length).toBeGreaterThan(0);
    });
  });

  it("took() returns a non-negative number", () => {
    const ctx = HttpContext.fake();
    RequestContext.run(ctx, () => {
      expect(typeof RequestContext.took()).toBe("number");
      expect(RequestContext.took()).toBeGreaterThanOrEqual(0);
    });
  });

  it('locale() returns "en" by default', () => {
    const ctx = HttpContext.fake();
    RequestContext.run(ctx, () => {
      expect(RequestContext.locale()).toBe("en");
    });
  });

  it("transaction() returns undefined when no transaction is set", () => {
    const ctx = HttpContext.fake();
    RequestContext.run(ctx, () => {
      expect(RequestContext.transaction()).toBeUndefined();
    });
  });

  it("transaction() returns the value when _transaction is set on ctx", () => {
    const ctx = HttpContext.fake();
    ctx._transaction = { id: "tx-123" };
    RequestContext.run(ctx, () => {
      expect(RequestContext.transaction()).toEqual({ id: "tx-123" });
    });
  });

  it("transaction() returns undefined outside of run()", () => {
    expect(RequestContext.transaction()).toBeUndefined();
  });
});
