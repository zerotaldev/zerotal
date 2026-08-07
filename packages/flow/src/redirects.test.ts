import { describe, it, expect, beforeAll } from "bun:test";
import { Router, RequestContext } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  // Register the named routes that redirectRoute() resolves against.
  Router.get("/users/:id", () => {}).name("profile");
  Router.get("/posts/:slug", () => {}).name("posts.show");
});

class Page extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }

  @expose goToProfile(): unknown {
    return this.redirectRoute("profile", { id: 1 });
  }
  @expose goToPostWithQuery(): unknown {
    return this.redirectRoute("posts.show", { slug: "hello", ref: "email" });
  }
  @expose goIntended(): unknown {
    return this.redirectIntended("/fallback");
  }
}

/** Run inside a request context carrying a session (mirrors the WS pipeline at runtime). */
function inRequest<T>(session: Record<string, unknown>, fn: () => T): T {
  const store = new Map<string, unknown>(Object.entries(session));
  const ctx = {
    url: { origin: "http://localhost" },
    session: {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => store.set(k, v),
      forget: (k: string) => store.delete(k),
      has: (k: string) => store.has(k),
    },
    _forgot: store,
  };
  return RequestContext.run(ctx as never, fn);
}

describe("redirectRoute", () => {
  it("builds the URL from a named route + params", () => {
    const p = new Page();
    p.goToProfile();
    expect(p._redirectUrl).toBe("/users/1");
  });

  it("puts extra (non-segment) params in the query string", () => {
    const p = new Page();
    p.goToPostWithQuery();
    expect(p._redirectUrl).toBe("/posts/hello?ref=email");
  });
});

describe("redirectIntended", () => {
  it("redirects to the stored intended_url and clears it", () => {
    const p = new Page();
    const store = new Map<string, unknown>([["intended_url", "http://localhost/dashboard"]]);
    const ctx = {
      url: { origin: "http://localhost" },
      session: {
        get: (k: string) => store.get(k),
        forget: (k: string) => store.delete(k),
      },
    };
    RequestContext.run(ctx as never, () => p.goIntended());
    expect(p._redirectUrl).toBe("http://localhost/dashboard");
    expect(store.has("intended_url")).toBe(false); // cleared
  });

  it("falls back to the default when nothing is stored", () => {
    const p = new Page();
    inRequest({}, () => p.goIntended());
    expect(p._redirectUrl).toBe("/fallback");
  });

  it("falls back when the stored URL is cross-origin (open-redirect guard)", () => {
    const p = new Page();
    inRequest({ intended_url: "http://evil.example/steal" }, () => p.goIntended());
    expect(p._redirectUrl).toBe("/fallback");
  });
});
