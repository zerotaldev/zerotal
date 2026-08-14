/** @jsxImportSource @zerotal/flow */
import { describe, it, expect, beforeAll, spyOn } from "bun:test";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { ErrorBoundary } from "./components.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/** A child that always fails during render. */
class BrokenWidget extends Component {
  override async render(): Promise<HtmlNode> {
    throw new Error("widget exploded");
  }
}

/** A child that fails during mount, before render is ever reached. */
class BrokenOnMount extends Component {
  override async onMount() {
    throw new Error("mount exploded");
  }
  override async render() {
    return <p>never seen</p>;
  }
}

class HealthyWidget extends Component {
  @expose label = "fine";
  override async render() {
    return <p>healthy</p>;
  }
}

/** Render a page, silencing the boundary's console.error. */
async function render(page: Component): Promise<string> {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    return await _renderFlowPage(page, () => page.render());
  } finally {
    quiet.mockRestore();
  }
}

describe("<ErrorBoundary>", () => {
  it("replaces a failed child with the fallback and keeps the rest of the page", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <h1>Dashboard</h1>
            <ErrorBoundary fallback={<p>Sales unavailable</p>}>
              <BrokenWidget />
            </ErrorBoundary>
            <span>after</span>
          </div>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("<p>Sales unavailable</p>");
    expect(html).toContain("<h1>Dashboard</h1>");
    expect(html).toContain("<span>after</span>");
    expect(html).not.toContain("widget exploded");
  });

  it("catches a child that fails in onMount, not just render", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary fallback={<p>caught</p>}>
            <BrokenOnMount />
          </ErrorBoundary>
        );
      }
    }

    expect(await render(new Page())).toContain("<p>caught</p>");
  });

  it("passes the error to a function fallback", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary fallback={(e) => <p>{(e as Error).message}</p>}>
            <BrokenWidget />
          </ErrorBoundary>
        );
      }
    }

    expect(await render(new Page())).toContain("widget exploded");
  });

  it("reports the error through onError", async () => {
    const seen: unknown[] = [];
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary fallback={<p>x</p>} onError={(e) => seen.push(e)}>
            <BrokenWidget />
          </ErrorBoundary>
        );
      }
    }

    await render(new Page());
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe("widget exploded");
  });

  it("still renders the fallback when onError itself throws", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary
            fallback={<p>survived</p>}
            onError={() => {
              throw new Error("reporter broke");
            }}
          >
            <BrokenWidget />
          </ErrorBoundary>
        );
      }
    }

    expect(await render(new Page())).toContain("<p>survived</p>");
  });

  it("uses a default fallback when none is given", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary>
            <BrokenWidget />
          </ErrorBoundary>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("data-flow-boundary-error");
    expect(html).toContain('role="alert"');
  });

  it("leaves a healthy child completely alone", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary fallback={<p>nope</p>}>
            <HealthyWidget />
          </ErrorBoundary>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("healthy");
    expect(html).not.toContain("nope");
    // The child is still a real, hydratable Flow root, not inert markup.
    expect(html).toContain("data-flow-root");
  });

  it("does NOT swallow a failure outside any boundary", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <BrokenWidget />
          </div>
        );
      }
    }

    // Containment is opt-in: an unwrapped child must still take the page down,
    // or real bugs would render as blank space forever.
    expect(render(new Page())).rejects.toThrow("widget exploded");
  });

  it("contains one failing sibling without affecting the other", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <ErrorBoundary fallback={<p>first failed</p>}>
              <BrokenWidget />
            </ErrorBoundary>
            <ErrorBoundary fallback={<p>second failed</p>}>
              <HealthyWidget />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("first failed");
    expect(html).toContain("healthy");
    expect(html).not.toContain("second failed");
  });

  it("lets the innermost boundary win when they nest", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary fallback={<p>outer</p>}>
            <div>
              <ErrorBoundary fallback={<p>inner</p>}>
                <BrokenWidget />
              </ErrorBoundary>
            </div>
          </ErrorBoundary>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("<p>inner</p>");
    expect(html).not.toContain("<p>outer</p>");
  });

  it("marks its wrapper so the boundary is identifiable in the DOM", async () => {
    class Page extends Component {
      override async render() {
        return (
          <ErrorBoundary class="my-box">
            <HealthyWidget />
          </ErrorBoundary>
        );
      }
    }

    const html = await render(new Page());
    expect(html).toContain("data-flow-boundary");
    expect(html).toContain('class="my-box"');
  });
});
