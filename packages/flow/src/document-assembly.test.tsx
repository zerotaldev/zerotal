/** @jsxImportSource @zerotal/flow */
/**
 * The whole-document path: sections resolved across page *and* layout, in the
 * response actually produced by the route handler.
 *
 * `sections.test.ts` covers the store in isolation. What only shows up here is
 * that resolution happens late enough — an outlet rendered by the layout is
 * filled by content the page published before the layout ever ran.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Container, HttpContext, RequestContext, ScopedResolver } from "@zerotal/core";
import { Component } from "./Component.ts";
import { _makeFlowHandler } from "./router.ts";
import { SectionContent, SectionOutlet } from "./components.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

function context(url = "http://localhost/dash"): HttpContext {
  return new HttpContext(new Request(url), new ScopedResolver(new Container()));
}

/**
 * Run a page through its real route handler and return the response body.
 *
 * Wrapped in `RequestContext.run`, which is what the server's fetch handler does
 * — without it `HttpContext.tryGet()` is undefined everywhere.
 */
async function get(PageClass: unknown, url?: string): Promise<{ body: string; res: Response }> {
  const ctx = context(url);
  const Handler = _makeFlowHandler("/dash", PageClass as never);
  await RequestContext.run(ctx, () => new Handler().handle(ctx));
  const res = ctx.response!;
  return { body: await res.text(), res };
}

describe("sections across page and layout", () => {
  it("renders page-published content inside the layout that wraps it", async () => {
    class Page extends Component {
      override layout(page: HtmlNode): HtmlNode {
        return {
          html: `<div class="shell"><header>${SectionOutlet({ name: "toolbar" }).html}</header>${page.html}</div>`,
        };
      }
      override async render() {
        return (
          <div>
            <SectionContent name="toolbar">
              <button>Publish</button>
            </SectionContent>
            <p>body</p>
          </div>
        );
      }
    }

    const { body } = await get(Page);
    expect(body).toContain("<header><button>Publish</button></header>");
    expect(body).toContain("<p>body</p>");
    // No token survives into the delivered document.
    expect(body).not.toContain("flow-section:");
  });

  it("falls back to the outlet's default when the page publishes nothing", async () => {
    class Page extends Component {
      override layout(page: HtmlNode): HtmlNode {
        return {
          html: `<header>${SectionOutlet({ name: "toolbar", children: { html: "<em>none</em>" } }).html}</header>${page.html}`,
        };
      }
      override async render() {
        return <p>body</p>;
      }
    }

    const { body } = await get(Page);
    expect(body).toContain("<header><em>none</em></header>");
    expect(body).not.toContain("flow-section:");
  });
});
