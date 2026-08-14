/** @jsxImportSource @zerotal/flow */
/**
 * The whole-document path: sections resolved across page *and* layout, and the
 * streamed response actually produced by the route handler.
 *
 * The unit suites cover the stores in isolation. What only shows up here is
 * whether the request's async context survives into the ReadableStream that
 * renders streamed children after the shell has been flushed — the streamed
 * render calls `HttpContext.tryGet()`, and it runs long after `handle()` has
 * returned.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Container, HttpContext, RequestContext, ScopedResolver } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
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
 * — without it `HttpContext.tryGet()` is undefined everywhere, including on the
 * ordinary inline path, and the streaming assertions would prove nothing.
 */
async function get(PageClass: unknown, url?: string): Promise<{ body: string; res: Response }> {
  const ctx = context(url);
  const Handler = _makeFlowHandler("/dash", PageClass as never);
  await RequestContext.run(ctx, () => new Handler().handle(ctx));
  const res = ctx.response!;
  return { body: await res.text(), res };
}

class SlowWidget extends Component {
  @expose label = "x";
  override async onMount() {
    await Bun.sleep(2);
  }
  override async render() {
    return <p>slow content</p>;
  }
}

class ExplodingWidget extends Component {
  override async render(): Promise<HtmlNode> {
    throw new Error("stream child exploded");
  }
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

describe("streamed response", () => {
  it("sends the shell first, then the child, then closes the document", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <h1>Dashboard</h1>
            <SlowWidget stream />
          </div>
        );
      }
    }

    const { body, res } = await get(Page);

    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    // Order is what makes this progressive: the heading and the placeholder are
    // ahead of the streamed markup, and </body> is last.
    const heading = body.indexOf("<h1>Dashboard</h1>");
    const chunk = body.indexOf("data-flow-stream-for");
    const closing = body.indexOf("</body>");
    expect(heading).toBeGreaterThan(-1);
    expect(chunk).toBeGreaterThan(heading);
    expect(closing).toBeGreaterThan(chunk);

    // The real markup arrived, and the swap script came with it.
    expect(body).toContain("slow content");
    expect(body).toContain("document.currentScript");
    expect(body).toContain("data-flow-streaming");
  });

  it("keeps the request context alive for the streamed render", async () => {
    // The child's onMount runs inside the ReadableStream, long after handle()
    // returned. If the async context did not carry through, this would see no
    // HttpContext and the assertion below would fail.
    let sawContext = false;

    class ContextProbe extends Component {
      override async onMount(): Promise<void> {
        sawContext = HttpContext.tryGet() !== undefined;
      }
      override async render(): Promise<HtmlNode> {
        return <p>probed</p>;
      }
    }

    class Page extends Component {
      override async render() {
        return <ContextProbe stream />;
      }
    }

    const { body } = await get(Page);
    expect(sawContext).toBe(true);
    expect(body).toContain("probed");
  });

  it("replaces a failed streamed child with a notice, keeping the document valid", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <h1>Dashboard</h1>
            <ExplodingWidget stream />
          </div>
        );
      }
    }

    const { body, res } = await get(Page);

    // The shell was already on the wire, so the response cannot fail — the
    // placeholder is filled with a notice and the document still closes.
    expect(res.status).toBe(200);
    expect(body).toContain("<h1>Dashboard</h1>");
    expect(body).toContain("data-flow-stream-error");
    expect(body).not.toContain("stream child exploded");
    expect(body.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("sends an ordinary single-shot response when nothing streams", async () => {
    class Page extends Component {
      override async render() {
        return <p>plain</p>;
      }
    }

    const { body, res } = await get(Page);
    expect(body).toContain("<p>plain</p>");
    expect(body).not.toContain("data-flow-stream-for");
    // No streaming header on a response that does not stream.
    expect(res.headers.get("X-Accel-Buffering")).toBeNull();
  });

  it("resolves sections in a streamed document too", async () => {
    class Page extends Component {
      override layout(page: HtmlNode): HtmlNode {
        return { html: `<header>${SectionOutlet({ name: "t" }).html}</header>${page.html}` };
      }
      override async render() {
        return (
          <div>
            <SectionContent name="t">
              <b>Title</b>
            </SectionContent>
            <SlowWidget stream />
          </div>
        );
      }
    }

    const { body } = await get(Page);
    expect(body).toContain("<header><b>Title</b></header>");
    expect(body).toContain("slow content");
    expect(body).not.toContain("flow-section:");
  });
});
