import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import { FlowTest } from "./testing.ts";
import { jsx } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/** A design-system-style shell: header / body / footer slots, header+footer optional. */
class Card extends Component {
  override async render(): Promise<HtmlNode> {
    return {
      html:
        `<div class="card">` +
        (this.hasSlot("header") ? `<header>${this.slot("header").html}</header>` : "") +
        `<main>${this.slot().html}</main>` +
        (this.hasSlot("footer") ? `<footer>${this.slot("footer").html}</footer>` : "") +
        `</div>`,
    };
  }
}

class CardParent extends Component {
  override async render(): Promise<HtmlNode> {
    return jsx(Card, {
      slots: {
        header: jsx("h2", { children: "Title" }) as HtmlNode,
        footer: jsx("button", { children: "OK" }) as HtmlNode,
      },
      children: jsx("p", { children: "Body text" }) as HtmlNode,
    }) as HtmlNode;
  }
}

/** Only a default slot — no named slots supplied. */
class DefaultOnlyParent extends Component {
  override async render(): Promise<HtmlNode> {
    return jsx(Card, { children: jsx("p", { children: "just a body" }) as HtmlNode }) as HtmlNode;
  }
}

describe("named slots — SSR capture and placement", () => {
  it("routes default children and named slots to this.slot(name)", async () => {
    const t = await FlowTest.mount(CardParent);
    const html = t.html();
    expect(html).toContain("<header><h2>Title</h2></header>");
    expect(html).toContain("<main><p>Body text</p></main>");
    expect(html).toContain("<footer><button>OK</button></footer>");
  });

  it("omits optional slot wrappers when no content is supplied", async () => {
    const t = await FlowTest.mount(DefaultOnlyParent);
    const html = t.html();
    expect(html).toContain("<main><p>just a body</p></main>");
    expect(html).not.toContain("<header>");
    expect(html).not.toContain("<footer>");
  });
});

describe("named slots — snapshot round-trip", () => {
  it("dehydrate carries slot HTML in memo.slots; hydrate restores _flowSlots", async () => {
    const c = new Card();
    c._flowSlots = { default: "<p>Body</p>", header: "<h2>Title</h2>" };

    const snap = dehydrate(c, { id: "card1", name: "Card", path: "/t" });
    expect(snap.memo.slots).toEqual({ default: "<p>Body</p>", header: "<h2>Title</h2>" });

    const restored = await hydrate(snap, Card);
    expect(restored.slot("header").html).toBe("<h2>Title</h2>");
    expect(restored.slot().html).toBe("<p>Body</p>");
    expect(restored.hasSlot("footer")).toBe(false);
  });

  it("re-renders the child from its snapshot with slot content intact", async () => {
    const c = new Card();
    c._flowSlots = { default: "<p>Body</p>", header: "<h2>Live</h2>" };
    const snap = dehydrate(c, { id: "card1", name: "Card", path: "/t" });

    // Simulate a child-only WS action: rebuild from snapshot (parent does not run).
    const restored = await hydrate(snap, Card);
    const html = (await restored.render()).html;
    expect(html).toContain("<header><h2>Live</h2></header>");
    expect(html).toContain("<main><p>Body</p></main>");
  });

  it("omits memo.slots entirely when the component has no slots", () => {
    const c = new Card();
    const snap = dehydrate(c, { id: "card2", name: "Card", path: "/t" });
    expect(snap.memo.slots).toBeUndefined();
  });

  it("a tampered slot value fails the snapshot checksum (slots are signed)", async () => {
    const c = new Card();
    c._flowSlots = { default: "<p>trusted</p>" };
    const snap = dehydrate(c, { id: "card3", name: "Card", path: "/t" });

    snap.memo.slots = { default: "<script>evil()</script>" };
    await expect(hydrate(snap, Card)).rejects.toThrow();
  });
});
