import { describe, it, expect, beforeEach } from "bun:test";
import { Uri, uri } from "./Uri.ts";
import { ResponseBuilder } from "../helpers/response.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { RequestContext } from "../context/RequestContext.ts";
import { Router } from "../router/Router.ts";

function makeCtx(url = "http://localhost/", init: RequestInit = {}): HttpContext {
  return HttpContext.fake(url, init);
}
function inRequest<T>(ctx: HttpContext, fn: () => T): T {
  return RequestContext.run(ctx, fn);
}

describe("Uri — parsing & inspectors", () => {
  it("parses an absolute URL", () => {
    const u = Uri.of("https://user:pw@example.com:8443/users?page=1&sort=name#top");
    expect(u.scheme()).toBe("https");
    expect(u.user()).toBe("user");
    expect(u.password()).toBe("pw");
    expect(u.host()).toBe("example.com");
    expect(u.port()).toBe(8443);
    expect(u.path()).toBe("/users");
    expect(u.fragment()).toBe("top");
    expect(u.query().get("page")).toBe("1");
    expect(u.query().has("sort")).toBe(true);
  });

  it("parses a relative URL", () => {
    const u = Uri.of("/dashboard?tab=2#section");
    expect(u.host()).toBeUndefined();
    expect(u.path()).toBe("/dashboard");
    expect(u.query().get("tab")).toBe("2");
    expect(u.fragment()).toBe("section");
    expect(u.value()).toBe("/dashboard?tab=2#section");
  });
});

describe("Uri — immutable mutators", () => {
  it("withQuery merges, replaceQuery replaces, withoutQuery removes", () => {
    const base = Uri.of("/u?page=1&keep=yes");
    expect(base.withQuery({ page: 2, sort: "name" }).value()).toBe("/u?page=2&keep=yes&sort=name");
    expect(base.replaceQuery({ only: "this" }).value()).toBe("/u?only=this");
    expect(base.withoutQuery(["page"]).value()).toBe("/u?keep=yes");
    // original is untouched (immutability)
    expect(base.value()).toBe("/u?page=1&keep=yes");
  });

  it("withQueryIfMissing only adds absent keys", () => {
    const u = Uri.of("/p?a=1").withQueryIfMissing({ a: 9, b: 2 });
    expect(u.query().get("a")).toBe("1");
    expect(u.query().get("b")).toBe("2");
  });

  it("pushOntoQuery builds multi-value params", () => {
    const u = Uri.of("/p?tag=x").pushOntoQuery("tag", "y");
    expect(u.query().getAll("tag")).toEqual(["x", "y"]);
    expect(u.value()).toBe("/p?tag=x&tag=y");
  });

  it("withScheme/withHost/withPort/withPath/withFragment rebuild the URL", () => {
    const u = Uri.of("https://example.com/a")
      .withHost("other.test")
      .withPort(9000)
      .withPath("b")
      .withFragment("f");
    expect(u.value()).toBe("https://other.test:9000/b#f");
  });
});

describe("uri() helper", () => {
  it("uri(value) builds from a string", () => {
    expect(uri("/x?y=1").value()).toBe("/x?y=1");
  });

  it("uri() with no args uses the current request URL", () => {
    const ctx = makeCtx("http://localhost/posts?page=3");
    const out = inRequest(ctx, () => uri().withoutQuery(["page"]).value());
    expect(out).toBe("http://localhost/posts");
  });
});

describe("Uri.route()", () => {
  beforeEach(() => {
    Router.reset();
    Router.get("/u/:username", () => {}).name("profile");
  });
  it("resolves a named route to a Uri", () => {
    expect(Uri.route("profile", { username: "alice" }).value()).toBe("/u/alice");
  });
});

describe("uri().intended()", () => {
  it("resolves the stored intended_url and forgets it", () => {
    const ctx = makeCtx();
    let forgot: string | undefined;
    (ctx as unknown as Record<string, unknown>)["session"] = {
      get: (k: string) => (k === "intended_url" ? "http://localhost/dashboard" : undefined),
      forget: (k: string) => {
        forgot = k;
      },
    };
    const out = inRequest(ctx, () => uri().intended("/fallback").value());
    expect(out).toBe("http://localhost/dashboard");
    expect(forgot).toBe("intended_url");
  });

  it("falls back when nothing is stored", () => {
    const ctx = makeCtx();
    (ctx as unknown as Record<string, unknown>)["session"] = {
      get: () => undefined,
      forget: () => {},
    };
    const out = inRequest(ctx, () => uri().intended("/dashboard").value());
    expect(out).toBe("/dashboard");
  });

  it(".redirect() sets the response and returns a ResponseBuilder", () => {
    const ctx = makeCtx();
    (ctx as unknown as Record<string, unknown>)["session"] = {
      get: () => undefined,
      forget: () => {},
    };
    const result = inRequest(ctx, () => uri().intended("/dashboard").redirect());
    expect(result).toBeInstanceOf(ResponseBuilder);
    expect(ctx.response?.headers.get("Location")).toBe("/dashboard");
    expect(ctx.response?.status).toBe(302);
  });
});
