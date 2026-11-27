import { describe, it, expect } from "bun:test";
import { HttpContext, RequestContext } from "@zerotal/core";
import { currentUser, currentUserId } from "@zerotal/core/auth";

/** A request with `user` set the way the auth middleware sets it. */
function withUser(user: unknown): HttpContext {
  const ctx = HttpContext.fake("http://localhost/");
  Reflect.set(ctx, "user", user);
  return ctx;
}

describe("currentUser()", () => {
  it("reads the user the auth middleware put on the request", () => {
    const user = { id: 7, name: "Ada" };
    expect(currentUser(withUser(user))).toBe(user);
  });

  it("reads the request being handled when given none", () => {
    const user = { id: 7 };
    const ctx = withUser(user);
    expect(RequestContext.run(ctx, () => currentUser())).toBe(user);
  });

  it("is undefined for a guest, a null user, or outside a request", () => {
    expect(currentUser(HttpContext.fake("http://localhost/"))).toBeUndefined();
    expect(currentUser(withUser(null))).toBeUndefined();
    expect(currentUser(withUser("7"))).toBeUndefined();
    expect(currentUser()).toBeUndefined();
  });
});

describe("currentUserId()", () => {
  it("stringifies the id, keeping 0 as an id", () => {
    expect(currentUserId(withUser({ id: 42 }))).toBe("42");
    expect(currentUserId(withUser({ id: 0 }))).toBe("0");
  });

  it("is undefined for a guest or a user without an id", () => {
    expect(currentUserId(withUser(undefined))).toBeUndefined();
    expect(currentUserId(withUser({ id: null }))).toBeUndefined();
    expect(currentUserId(withUser({}))).toBeUndefined();
  });
});
