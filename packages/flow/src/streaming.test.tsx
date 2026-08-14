/** @jsxImportSource @zerotal/flow */
import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import {
  createStreamStore,
  runWithStreaming,
  getStreamStore,
  queueStream,
  streamChunk,
} from "./streaming.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class SlowWidget extends Component {
  @expose label = "loaded";
  override async onMount() {
    await Bun.sleep(1);
  }
  override async render() {
    return <p>report ready</p>;
  }
}

describe("stream store", () => {
  it("is absent outside a streaming render", () => {
    expect(getStreamStore()).toBeUndefined();
    // Queueing outside a request must not throw — `stream` degrades to an
    // ordinary child render rather than failing the response.
    expect(() => queueStream({ childId: "x", render: async () => "" })).not.toThrow();
  });

  it("keeps two concurrent requests apart", async () => {
    const a = createStreamStore();
    const b = createStreamStore();

    await Promise.all([
      runWithStreaming(a, async () => {
        await Bun.sleep(1);
        queueStream({ childId: "a1", render: async () => "A" });
      }),
      runWithStreaming(b, async () => {
        queueStream({ childId: "b1", render: async () => "B" });
      }),
    ]);

    expect(a.pending.map((p) => p.childId)).toEqual(["a1"]);
    expect(b.pending.map((p) => p.childId)).toEqual(["b1"]);
  });
});

describe("streamChunk()", () => {
  it("wraps markup in an inert template plus a swap script", () => {
    const chunk = streamChunk("dash-slow-0", "<p>hi</p>");
    // A <template> so the parser neither renders nor executes the payload where
    // it lands, mid-document.
    expect(chunk).toContain('<template data-flow-stream-for="dash-slow-0">');
    expect(chunk).toContain("<p>hi</p>");
    expect(chunk).toContain("document.currentScript");
    expect(chunk).toContain("CSS.escape");
  });

  it("escapes the child id so it cannot break out of the attribute", () => {
    // Flow builds child ids itself and sanitises the key, so a hostile id is not
    // reachable today; the escaping is what keeps that true if it ever changes.
    const chunk = streamChunk('a"><img onerror=alert(1)>', "<p>x</p>");

    const value = /data-flow-stream-for="([^"]*)"/.exec(chunk)?.[1];
    expect(value).toBeDefined();
    // The whole id survives inside the attribute, with nothing that could end it
    // early or open a tag.
    expect(value).toContain("&quot;");
    expect(value).toContain("&lt;img");
    expect(chunk).not.toContain('for="a"><img');
  });
});

describe("<Widget stream />", () => {
  it("renders a placeholder inline and queues the real render", async () => {
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

    const store = createStreamStore();
    const page = new Page();
    page._flowId = "dash";

    const html = await runWithStreaming(store, () => _renderFlowPage(page, () => page.render()));

    // The shell is complete and the slow child is not in it yet.
    expect(html).toContain("<h1>Dashboard</h1>");
    expect(html).toContain("data-flow-streaming");
    expect(html).not.toContain("report ready");

    // ...but it is queued, and rendering it produces the real markup plus the
    // state script the client needs to hydrate it.
    expect(store.pending).toHaveLength(1);
    const markup = await store.pending[0]!.render();
    expect(markup).toContain("report ready");
    expect(markup).toContain(`id="flow-state-${store.pending[0]!.childId}"`);
  });

  it("renders inline when there is no response to stream on", async () => {
    // A WebSocket patch has no open response, so `stream` must degrade to an
    // ordinary child rather than leaving a placeholder that never resolves.
    class Page extends Component {
      override async render() {
        return <SlowWidget stream />;
      }
    }

    const page = new Page();
    page._flowId = "ws";
    const html = await _renderFlowPage(page, () => page.render());

    expect(html).toContain("report ready");
    expect(html).not.toContain("data-flow-streaming");
  });

  it("gives the placeholder the same id the chunk targets", async () => {
    class Page extends Component {
      override async render() {
        return <SlowWidget stream />;
      }
    }

    const store = createStreamStore();
    const page = new Page();
    page._flowId = "dash";
    const html = await runWithStreaming(store, () => _renderFlowPage(page, () => page.render()));

    const childId = store.pending[0]!.childId;
    expect(html).toContain(`data-flow-id="${childId}"`);
    expect(streamChunk(childId, "x")).toContain(childId);
  });

  it("streams several children, preserving order", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <SlowWidget key="a" stream />
            <SlowWidget key="b" stream />
          </div>
        );
      }
    }

    const store = createStreamStore();
    const page = new Page();
    page._flowId = "dash";
    await runWithStreaming(store, () => _renderFlowPage(page, () => page.render()));

    expect(store.pending).toHaveLength(2);
    expect(store.pending[0]!.childId).toContain("-a");
    expect(store.pending[1]!.childId).toContain("-b");
  });

  it("leaves non-streamed children rendered inline", async () => {
    class Page extends Component {
      override async render() {
        return (
          <div>
            <SlowWidget key="inline" />
            <SlowWidget key="streamed" stream />
          </div>
        );
      }
    }

    const store = createStreamStore();
    const page = new Page();
    page._flowId = "dash";
    const html = await runWithStreaming(store, () => _renderFlowPage(page, () => page.render()));

    expect(html).toContain("report ready"); // the inline one
    expect(store.pending).toHaveLength(1); // only the streamed one deferred
    expect(store.pending[0]!.childId).toContain("streamed");
  });
});
