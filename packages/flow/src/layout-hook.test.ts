import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { _layoutId } from "./router.ts";
import { jsx } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/** A plain function-component layout — regions are ordinary props (no slot machinery). */
function AppLayout(props: { title?: string; children?: unknown }): HtmlNode {
  return jsx("div", {
    class: "shell",
    children: [jsx("header", { children: props.title }), jsx("main", { children: props.children })],
  }) as HtmlNode;
}

class BarePage extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<p>bare</p>" };
  }
}

class DashboardPage extends Component {
  static title = "Dashboard";
  override layout(page: HtmlNode): HtmlNode {
    return AppLayout({ title: DashboardPage.title, children: page }) as HtmlNode;
  }
  override async render(): Promise<HtmlNode> {
    return { html: "<p>dash</p>" };
  }
}

// Two pages that wrap with the SAME source (no page-specific refs) share a layout id —
// the zero-annotation `(page) => <AppLayout>{page}</AppLayout>` case.
class ListAPage extends Component {
  override layout(page: HtmlNode): HtmlNode {
    return AppLayout({ children: page }) as HtmlNode;
  }
  override async render(): Promise<HtmlNode> {
    return { html: "<p>a</p>" };
  }
}
class ListBPage extends Component {
  override layout(page: HtmlNode): HtmlNode {
    return AppLayout({ children: page }) as HtmlNode;
  }
  override async render(): Promise<HtmlNode> {
    return { html: "<p>b</p>" };
  }
}

describe("Component.layout() hook", () => {
  it("defaults to identity (returns the page node unchanged → router uses no layout)", async () => {
    const p = new BarePage();
    const root: HtmlNode = { html: "<div data-flow-root>x</div>" };
    const wrapped = await p.layout(root);
    expect(wrapped).toBe(root); // reference identity — the router's `wrapped !== flowRoot` branch
  });

  it("an override wraps the page root in JSX (regions are plain props)", async () => {
    const p = new DashboardPage();
    const root: HtmlNode = { html: "<div data-flow-root>body</div>" };
    const wrapped = await p.layout(root);
    expect(wrapped).not.toBe(root);
    expect(wrapped.html).toContain('<div class="shell">');
    expect(wrapped.html).toContain("<header>Dashboard</header>");
    expect(wrapped.html).toContain("<main><div data-flow-root>body</div></main>");
  });
});

describe("_layoutId — nav-persistence marker", () => {
  it("is stable for identical wrapper sources (shared layout → shell persists on navigate)", () => {
    expect(_layoutId(new ListAPage())).toBe(_layoutId(new ListBPage()));
  });

  it("differs from the default (unwrapped) layout method", () => {
    expect(_layoutId(new DashboardPage())).not.toBe(_layoutId(new BarePage()));
  });

  it("produces a compact string marker", () => {
    expect(_layoutId(new DashboardPage())).toMatch(/^l[0-9a-z]+$/);
  });
});
