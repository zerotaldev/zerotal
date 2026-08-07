import { describe, it, expect, beforeEach } from "bun:test";
import { Router } from "./Router.ts";
import type { ModelBindingResolver } from "./Route.ts";

const captured: unknown[] = [];

class FakeModel {
  static async findOrFail(id: number | string): Promise<unknown> {
    captured.push(id);
    return { id };
  }
}
class FakeController {
  show(): void {}
}

beforeEach(() => {
  Router.reset();
  captured.length = 0;
});

function resolverFor(routeKey: string, param: string): ModelBindingResolver {
  const def = Router.routes.get(routeKey)!;
  return def.bindings.get(param)!;
}

describe("route-model binding — id coercion", () => {
  it("coerces a digit-only id to a number", async () => {
    Router.get("/users/:user", FakeController as never, "show").bind("user", FakeModel as never);
    const resolve = resolverFor("GET /users/:user", "user");
    await resolve("42", {} as never);
    expect(captured).toEqual([42]);
    expect(typeof captured[0]).toBe("number");
  });
  it("passes a non-numeric id (UUID/slug) through unchanged", async () => {
    Router.get("/posts/:post", FakeController as never, "show").bind("post", FakeModel as never);
    const resolve = resolverFor("GET /posts/:post", "post");
    await resolve("3f9a-hello", {} as never);
    expect(captured).toEqual(["3f9a-hello"]);
    expect(typeof captured[0]).toBe("string");
  });
  it("bind() with a model class coerces the same way", async () => {
    Router.get("/widgets/:widget", FakeController as never, "show").bind(
      "widget",
      FakeModel as never,
    );
    Router.compile({} as never);
    const resolve = resolverFor("GET /widgets/:widget", "widget");
    await resolve("7", {} as never);
    expect(captured).toEqual([7]);
  });
});
