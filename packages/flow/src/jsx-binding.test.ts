import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { jsx, _injectedBindKey } from "./jsx-runtime.ts";
import { Modal } from "./components.ts";
import { FlowTest } from "./testing.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

// Regression: text={this.count} must bind to `count`, even when a sibling binding on the
// same element (class={"x " + this.accent}) is evaluated afterwards. All of an element's
// props are built before jsx() runs, so the single-slot getter capture ends up holding the
// last-accessed key (`accent`); the resolver must fall back to value identity so `text`
// still wins its own property.
class BindPage extends Component {
  @expose count = 7;
  @locked accent = "text-orange-600";

  override async render() {
    return jsx("p", { text: this.count, class: "big " + this.accent });
  }
}

// Reverse prop order — capture ends on `count`; the value guard must still be correct.
class BindPageReversed extends Component {
  @locked accent = "text-sky-600";
  @expose count = 3;

  override async render() {
    return jsx("p", { class: "big " + this.accent, text: this.count });
  }
}

describe("runtime text binding vs a sibling dynamic class", () => {
  it("binds text to its own property, not the class's prop", async () => {
    const t = await FlowTest.mount(BindPage);
    const html = t.html();
    expect(html).toContain('flow:text="count"');
    expect(html).not.toContain('flow:text="accent"');
    // The dynamic class still resolves to its value.
    expect(html).toContain("text-orange-600");
    // Initial paint shows the count value, not the accent string.
    expect(html).toContain(">7</p>");
  });

  it("resolves correctly regardless of prop order", async () => {
    const t = await FlowTest.mount(BindPageReversed);
    const html = t.html();
    expect(html).toContain('flow:text="count"');
    expect(html).not.toContain('flow:text="accent"');
    expect(html).toContain(">3</p>");
  });

  // Guards the removal of the "brute-force own-property scan" defence: an @locked prop
  // must resolve through the normal value-scan (its registration reliably lands in the
  // drained locked-set), even when a sibling binding clobbers the getter capture.
  it("resolves an @locked prop bound in text= via the value-scan", async () => {
    class LockedPage extends Component {
      @locked label = "Ready";
      @locked tone = "text-emerald-600"; // sibling class binding clobbers the capture
      override async render() {
        return jsx("span", { text: this.label, class: "badge " + this.tone });
      }
    }
    const t = await FlowTest.mount(LockedPage);
    const html = t.html();
    expect(html).toContain('flow:text="label"');
    expect(html).not.toContain('flow:text="tone"');
    expect(html).toContain(">Ready</span>");
  });
});

// The compiler's bind-name injection emits __flowBinds so a component resolves its bound
// prop statically. This is what makes an overlay-with-bound-children robust even when the
// bound props share a value (value-resolution would be ambiguous, the getter capture is
// clobbered by children). Mirrors what buildBindInjectedRender produces.
describe("__flowBinds injected bind resolution", () => {
  it("_injectedBindKey reads the per-attr key, or null", () => {
    expect(_injectedBindKey({ __flowBinds: { show: "sheetOpen" } }, "show")).toBe("sheetOpen");
    expect(_injectedBindKey({ __flowBinds: { bind: "x", query: "q" } }, "query")).toBe("q");
    expect(_injectedBindKey({ __flowBinds: { show: "x" } }, "bind")).toBeNull();
    expect(_injectedBindKey({}, "show")).toBeNull();
    expect(_injectedBindKey(null, "show")).toBeNull();
  });

  it("resolves an overlay's show binding via __flowBinds even when props share a value", async () => {
    // `open` and `decoy` are both false — value-resolution alone is ambiguous.
    class OverlayPage extends Component {
      @expose open = false;
      @expose decoy = false;
      override async render() {
        return jsx(Modal, {
          show: this.open,
          title: "T",
          __flowBinds: { show: "open" },
          children: "",
        });
      }
    }
    const t = await FlowTest.mount(OverlayPage);
    const html = t.html();
    expect(html).toContain('flow:show="open"');
    expect(html).not.toContain('flow:show="decoy"');
    // __flowBinds is internal — it must never leak as an HTML attribute.
    expect(html).not.toContain("__flowBinds");
  });
});
