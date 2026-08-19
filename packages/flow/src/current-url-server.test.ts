// `currentUrl()` and `navigateCurrent()` used to throw whenever they ran on the server, on
// the reasoning that the AOT compiler always rewrote them to `$flow.*` client expressions.
//
// The compiler bails for reasons that have nothing to do with these calls — a single `__()`
// anywhere in the page is enough, because a translated template is a function call in a text
// child — and the page then renders through the runtime renderer, where `render()` really does
// execute on the server. So a translated page with a paginated link threw, and the message
// blamed the reader for "calling it from a server action".
//
// Both paths feed the same pure `buildUrlWithQuery`, so what they produce cannot drift: the
// client passes `location.href`, the server passes the current request's URL.
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import { HttpContext, RequestContext } from "@zerotal/core";
import type { HtmlNode } from "./jsx-runtime.ts";

class Demo extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

const BASE = "https://example.test/users?search=john&status=active&page=2";

function inRequest<T>(fn: (c: Demo) => T, url = BASE): T {
  return RequestContext.run(HttpContext.fake(url), () => fn(new Demo()));
}

describe("currentUrl() on the server", () => {
  it("returns the current URL when given no changes", () => {
    expect(inRequest((c) => c.currentUrl())).toBe(BASE);
  });

  it("updates a listed param and preserves the rest", () => {
    expect(inRequest((c) => c.currentUrl({ query: { page: 3 } }))).toBe(
      "https://example.test/users?search=john&status=active&page=3",
    );
  });

  it("removes a param given a nullish value", () => {
    expect(inRequest((c) => c.currentUrl({ query: { status: null } }))).toBe(
      "https://example.test/users?search=john&page=2",
    );
  });

  it("adds a param that was not there", () => {
    expect(inRequest((c) => c.currentUrl({ query: { sort: "name" } }))).toBe(
      "https://example.test/users?search=john&status=active&page=2&sort=name",
    );
  });

  it("sets the hash", () => {
    expect(inRequest((c) => c.currentUrl({ hash: "top" }))).toBe(BASE + "#top");
  });
});

describe("navigateCurrent() on the server", () => {
  it("queues a redirect to the built URL rather than throwing", async () => {
    // The client SPA-navigates; the server has a redirect. Same destination.
    const c = await inRequest(async (comp) => {
      await comp.navigateCurrent({ query: { page: 5 } });
      return comp;
    });
    expect(c._redirectUrl).toBe("https://example.test/users?search=john&status=active&page=5");
  });

  it("drops a param on the redirect the same way currentUrl does", async () => {
    const c = await inRequest(async (comp) => {
      await comp.navigateCurrent({ query: { search: "" } });
      return comp;
    });
    expect(c._redirectUrl).toBe("https://example.test/users?status=active&page=2");
  });
});
