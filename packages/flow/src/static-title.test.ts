// `title` was an instance method, which made the name unusable for component state — the
// thing people most often want it for. It was also imperative: you called `this.title(…)`
// inside an action, so a title that tracked state meant remembering to set it everywhere the
// state changed.
//
// `static title` is declarative. A string, or a function of the component, resolved on the
// server for every frame — so the function form follows state on its own. Only the resolved
// string reaches the browser; the function never does.
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

class Plain extends Component {
  static override title = "Search";
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

class Dynamic extends Component {
  static override title = (c: Dynamic) => (c.query ? `Search: ${c.query}` : "Search");
  query = "";
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

class Untitled extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("static title", () => {
  it("resolves the string form", () => {
    expect(new Plain()._resolveTitle()).toBe("Search");
  });

  it("resolves the function form against the component", () => {
    const c = new Dynamic();
    expect(c._resolveTitle()).toBe("Search");
  });

  it("tracks state, without the action doing anything", () => {
    const c = new Dynamic();
    c.query = "iphone";
    expect(c._resolveTitle()).toBe("Search: iphone");
  });

  it("is null when the page declares none", () => {
    expect(new Untitled()._resolveTitle()).toBeNull();
  });

  it("rides the frame, so a patch carries the current title", () => {
    const c = new Dynamic();
    c.query = "pixel";
    expect(c._drainEffects().title).toBe("Search: pixel");
  });

  it("keeps resolving on later frames — it is not one-shot", () => {
    const c = new Dynamic();
    c.query = "a";
    expect(c._drainEffects().title).toBe("Search: a");
    c.query = "b";
    expect(c._drainEffects().title).toBe("Search: b");
  });
});
