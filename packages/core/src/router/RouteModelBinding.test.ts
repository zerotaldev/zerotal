import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Router, setImplicitModelResolver } from "./Router.ts";
import type { ModelClass } from "./Route.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { Container } from "../container/Container.ts";

// ── Fake models ───────────────────────────────────────────────────────────────

class FakeUser {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {}

  static async findOrFail(id: number): Promise<FakeUser> {
    if (id === 999)
      throw Object.assign(new Error("Not found"), { status: 404, code: "E_MODEL_NOT_FOUND" });
    return new FakeUser(id, `User #${id}`);
  }
}

class FakePost {
  constructor(
    readonly id: number,
    readonly slug: string,
  ) {}

  static async findOrFail(id: number): Promise<FakePost> {
    if (id === 999)
      throw Object.assign(new Error("Not found"), { status: 404, code: "E_MODEL_NOT_FOUND" });
    return new FakePost(id, `post-${id}`);
  }
}

// ── Fake controller ───────────────────────────────────────────────────────────

class TestController {
  async show(http: HttpContext): Promise<Response> {
    const user = http.model<FakeUser>("user");
    return Response.json({ id: user.id, name: user.name });
  }

  async showPost(http: HttpContext): Promise<Response> {
    const post = http.model<FakePost>("post");
    return Response.json({ id: post.id, slug: post.slug });
  }

  async showBoth(http: HttpContext): Promise<Response> {
    const user = http.model<FakeUser>("user");
    const post = http.model<FakePost>("post");
    return Response.json({ userId: user.id, postId: post.id });
  }

  async noModel(http: HttpContext): Promise<Response> {
    return Response.json({ params: http.params });
  }
}

// ── Binded<T> controller (second-argument DX) ─────────────────────────────────

class BindedController {
  async show(ctx: HttpContext<{ user: FakeUser }>): Promise<Response> {
    const user = ctx.params.user;
    return Response.json({ id: user.id, name: user.name });
  }

  async showPost(ctx: HttpContext<{ post: FakePost }>): Promise<Response> {
    const post = ctx.params.post;
    return Response.json({ id: post.id, slug: post.slug });
  }

  async showBoth(ctx: HttpContext<{ user: FakeUser; post: FakePost }>): Promise<Response> {
    const { user, post } = ctx.params;
    return Response.json({ userId: user.id, postId: post.id });
  }

  async rawParam(ctx: HttpContext<{ tab: string }>): Promise<Response> {
    return Response.json({ tab: ctx.params.tab });
  }

  async mixed(ctx: HttpContext<{ post: FakePost; tab: string }>): Promise<Response> {
    const { post, tab } = ctx.params;
    return Response.json({ postId: post.id, tab });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContainer(): Container {
  const c = new Container();
  c.singleton(TestController, () => new TestController());
  c.singleton(BindedController, () => new BindedController());
  return c;
}

function fakeRequest(path: string, params: Record<string, string> = {}): Request {
  const req = new Request(`http://localhost${path}`);
  (req as unknown as Record<string, unknown>).params = params;
  return req;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("route-model binding — .bind()", () => {
  beforeEach(() => {
    Router.reset();
    setImplicitModelResolver(null);
  });

  it("resolves a model and makes it available via ctx.model()", async () => {
    Router.get("/users/:user", TestController, "show").bind(
      "user",
      FakeUser as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user"]!["GET"]!;

    const res = await handler(fakeRequest("/users/1", { user: "42" }));
    const body = (await res.json()) as { id: number; name: string };
    expect(body.id).toBe(42);
    expect(body.name).toBe("User #42");
  });

  it("returns 404 when the model is not found", async () => {
    Router.get("/users/:user", TestController, "show").bind(
      "user",
      FakeUser as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user"]!["GET"]!;

    const res = await handler(fakeRequest("/users/999", { user: "999" }));
    expect(res.status).toBe(404);
  });

  it("skips resolution when the param is absent from the actual request", async () => {
    Router.get("/profile", TestController, "noModel").bind(
      "user",
      FakeUser as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/profile"]!["GET"]!;

    // No 'user' param — resolution is skipped, no error
    const res = await handler(fakeRequest("/profile", {}));
    const body = (await res.json()) as { params: Record<string, string> };
    expect(body.params).toEqual({});
  });
});

describe("RouteRegistration.bind() — per-route binding", () => {
  beforeEach(() => {
    Router.reset();
    setImplicitModelResolver(null);
  });
  // The implicit resolver is process-global and Router.reset() does not clear it, so a test
  // that installs one must take it back down or every later route binds through it.
  afterEach(() => setImplicitModelResolver(null));

  it("resolves a model for a specific route", async () => {
    Router.get("/posts/:post", TestController, "showPost").bind(
      "post",
      FakePost as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/posts/7", { post: "7" }));
    const body = (await res.json()) as { id: number; slug: string };
    expect(body.id).toBe(7);
    expect(body.slug).toBe("post-7");
  });

  it("bind() overrides the implicit resolver for the same param", async () => {
    setImplicitModelResolver(() => async () => {
      throw new Error("implicit resolver should not run");
    });

    let resolvedValue = "";
    Router.get("/users/:user", TestController, "show").bind("user", async (value) => {
      resolvedValue = value;
      return new FakeUser(Number(value), `custom-${value}`);
    });

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user"]!["GET"]!;

    const res = await handler(fakeRequest("/users/5", { user: "5" }));
    const body = (await res.json()) as { id: number; name: string };
    expect(body.id).toBe(5);
    expect(body.name).toBe("custom-5");
    expect(resolvedValue).toBe("5");
  });

  it("supports a custom async resolver function", async () => {
    Router.get("/posts/:post", TestController, "showPost").bind(
      "post",
      async (slug) => new FakePost(99, slug),
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/posts/hello-world", { post: "hello-world" }));
    const body = (await res.json()) as { id: number; slug: string };
    expect(body.id).toBe(99);
    expect(body.slug).toBe("hello-world");
  });

  it("returns 404 when a per-route resolver throws", async () => {
    Router.get("/posts/:post", TestController, "showPost").bind("post", async () => {
      throw Object.assign(new Error("not found"), { status: 404 });
    });

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/posts/missing", { post: "missing" }));
    expect(res.status).toBe(404);
  });

  it("resolves multiple models on the same route", async () => {
    Router.get("/users/:user/posts/:post", TestController, "showBoth")
      .bind("user", FakeUser as unknown as ModelClass)
      .bind("post", FakePost as unknown as ModelClass);

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/users/1/posts/2", { user: "1", post: "2" }));
    const body = (await res.json()) as { userId: number; postId: number };
    expect(body.userId).toBe(1);
    expect(body.postId).toBe(2);
  });
});

describe("ctx.model() — accessor", () => {
  beforeEach(() => Router.reset());

  it("throws a descriptive error when no binding was resolved for the param", async () => {
    Router.get("/items/:id", TestController, "show");

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/items/:id"]!["GET"]!;

    // No binding registered — controller calls ctx.model('user') which should throw
    const res = await handler(fakeRequest("/items/1", { id: "1" }));
    expect(res.status).toBe(500); // unhandled error → exception handler → 500
  });

  it("Binded<T> second argument receives the resolved model instance", async () => {
    Router.get("/users/:user", BindedController, "show").bind(
      "user",
      FakeUser as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user"]!["GET"]!;

    const res = await handler(fakeRequest("/users/7", { user: "7" }));
    const body = (await res.json()) as { id: number; name: string };
    expect(body.id).toBe(7);
    expect(body.name).toBe("User #7");
  });

  it("Binded<T> raw params are accessible when no binding is registered", async () => {
    Router.get("/items/:tab", BindedController, "rawParam");

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/items/:tab"]!["GET"]!;

    const res = await handler(fakeRequest("/items/details", { tab: "details" }));
    const body = (await res.json()) as { tab: string };
    expect(body.tab).toBe("details");
  });

  it("Binded<T> model instance overrides raw param with the same key", async () => {
    Router.get("/posts/:post", BindedController, "showPost").bind(
      "post",
      FakePost as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/posts/3", { post: "3" }));
    const body = (await res.json()) as { id: number; slug: string };
    expect(body.id).toBe(3); // instance, not raw string '3'
    expect(body.slug).toBe("post-3");
  });

  it("Binded<T> supports multiple models in a single destructure", async () => {
    Router.get("/users/:user/posts/:post", BindedController, "showBoth")
      .bind("user", FakeUser as unknown as ModelClass)
      .bind("post", FakePost as unknown as ModelClass);

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/users/:user/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/users/1/posts/2", { user: "1", post: "2" }));
    const body = (await res.json()) as { userId: number; postId: number };
    expect(body.userId).toBe(1);
    expect(body.postId).toBe(2);
  });

  it("Binded<T> mixed: model + raw param coexist in the bag", async () => {
    Router.get("/posts/:post", BindedController, "mixed").bind(
      "post",
      FakePost as unknown as ModelClass,
    );

    const compiled = Router.compile(makeContainer(), []);
    const handler = compiled["/posts/:post"]!["GET"]!;

    const res = await handler(fakeRequest("/posts/5", { post: "5", tab: "comments" }));
    const body = (await res.json()) as { postId: number; tab: string };
    expect(body.postId).toBe(5);
    expect(body.tab).toBe("comments");
  });

  it("chaining .name() and .bind() both work", () => {
    Router.reset();
    const reg = Router.get("/users/:user", TestController, "show")
      .name("users.show")
      .bind("user", FakeUser as unknown as ModelClass);
    expect(reg).toBeDefined();

    // Route is registered with name
    const def = [...Router.routes.values()][0]!;
    expect(def.bindings.has("user")).toBe(true);
  });
});

// ── Binding runs after middleware ─────────────────────────────────────────────
//
// Resolving bindings ahead of the pipeline put a database read and a 404 in
// front of authentication: a protected route answered 404 for a missing id and
// 401 for one that existed, which let anyone enumerate records without logging
// in. These pin the order so that cannot come back.

describe("route-model binding runs after middleware", () => {
  beforeEach(() => Router.reset());

  class Denying {
    async handle(): Promise<Response> {
      trace.push("middleware");
      return new Response("unauthorized", { status: 401 });
    }
  }

  const trace: string[] = [];

  class Tracked {
    constructor(readonly id: number) {}
    static async findOrFail(id: number): Promise<Tracked> {
      trace.push("binding");
      if (Number(id) === 999)
        throw Object.assign(new Error("Not found"), { status: 404, code: "E_MODEL_NOT_FOUND" });
      return new Tracked(Number(id));
    }
  }

  async function run(id: string): Promise<Response> {
    trace.length = 0;
    Router.get("/p/:post", TestController, "showPost", [Denying as never]).bind(
      "post",
      Tracked as unknown as ModelClass,
    );
    const compiled = Router.compile(makeContainer(), []);
    // compile() types each path as `Response | Record<string, handler>`; narrow
    // it rather than indexing through the union.
    const byMethod = compiled["/p/:post"] as Record<
      string,
      (req: Request) => Response | Promise<Response>
    >;
    return byMethod["GET"]!(fakeRequest(`/p/${id}`, { post: id }));
  }

  it("a blocking middleware short-circuits before any binding query runs", async () => {
    const res = await run("1");
    expect(res.status).toBe(401);
    expect(trace).toEqual(["middleware"]);
  });

  it("a missing record behind that middleware is indistinguishable from an existing one", async () => {
    const res = await run("999");
    // Must be the middleware's 401 — not a 404 that would reveal the row is absent.
    expect(res.status).toBe(401);
    expect(trace).toEqual(["middleware"]);
  });
});
