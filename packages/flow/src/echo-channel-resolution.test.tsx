// Regression cover for per-instance `@on` channel names.
//
// The channel a component subscribes to reaches the browser through
// `snapshot.memo.listeners`, and the client hands it straight to
// `Echo.private(channel)`. The decorator's argument, though, is read off the
// CLASS — so a template literal written inside a plain string
// (`"echo-private:issues.${this.issueId},CommentPosted"`, as the guide showed)
// is not interpolation at all: it reaches the browser with those eleven
// characters intact, subscribes to a channel nobody broadcasts to, and produces
// no error, no warning and no events.
//
// `@on` now also accepts `(self) => name`, resolved per instance in dehydrate()
// — the same split `@presence` and `@shared` already use.

import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { locked, on } from "./decorators.ts";
import { FlowTest } from "./testing.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

async function html(): Promise<HtmlNode> {
  return { html: "<div></div>" };
}

describe("@on channel resolution", () => {
  // Dehydrating signs the snapshot, which needs a key.
  beforeAll(() => {
    Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  });

  it("resolves a (self) => name listener against the instance", async () => {
    class IssuePage extends Component {
      @locked issueId = 42;

      @on((self) => `echo-private:issues.${self["issueId"]},CommentPosted`)
      async onComment(): Promise<void> {}

      override render = html;
    }

    const t = await FlowTest.mount(IssuePage);

    expect(t.snapshot()?.memo?.listeners).toEqual({
      "echo-private:issues.42,CommentPosted": "onComment",
    });
  });

  it("resolves per instance, not once per class", async () => {
    class IssuePage extends Component {
      @locked issueId = 0;

      @on((self) => `echo-private:issues.${self["issueId"]},CommentPosted`)
      async onComment(): Promise<void> {}

      override render = html;
    }

    const first = await FlowTest.mount(IssuePage, { issueId: 1 });
    const second = await FlowTest.mount(IssuePage, { issueId: 2 });

    expect(Object.keys(first.snapshot()?.memo?.listeners ?? {})).toEqual([
      "echo-private:issues.1,CommentPosted",
    ]);
    expect(Object.keys(second.snapshot()?.memo?.listeners ?? {})).toEqual([
      "echo-private:issues.2,CommentPosted",
    ]);
  });

  it("still passes a static name through untouched", async () => {
    class OrdersPage extends Component {
      @on("echo:orders,OrderPlaced")
      async onOrder(): Promise<void> {}

      override render = html;
    }

    const t = await FlowTest.mount(OrdersPage);

    expect(t.snapshot()?.memo?.listeners).toEqual({
      "echo:orders,OrderPlaced": "onOrder",
    });
  });

  it("drops a listener whose resolver throws rather than failing the render", async () => {
    class BrokenPage extends Component {
      @locked issue: { id: number } | null = null;

      // Reads through a null — the shape of a resolver that runs before onMount
      // has filled the field it depends on.
      @on((self) => `echo-private:issues.${(self["issue"] as { id: number }).id},E`)
      async onEvent(): Promise<void> {}

      override render = html;
    }

    const t = await FlowTest.mount(BrokenPage);

    // The page rendered; it simply has nothing to subscribe to.
    expect(t.snapshot()?.memo?.listeners).toBeUndefined();
  });

  it("keeps the method exposed either way", async () => {
    class Page extends Component {
      @locked roomId = "7";

      @on((self) => `echo-presence:room.${self["roomId"]},here`)
      async onHere(): Promise<void> {}

      override render = html;
    }

    // `@on` implies `@expose`; a resolver must not change that, or the client
    // would resolve a channel it is then refused permission to act on.
    const t = await FlowTest.mount(Page);
    await t.call("onHere");

    expect(t.snapshot()?.memo?.listeners).toEqual({
      "echo-presence:room.7,here": "onHere",
    });
  });
});
