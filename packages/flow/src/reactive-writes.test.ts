import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, reactive, modelable } from "./decorators.ts";
import { FlowTest } from "./testing.ts";
import { BUILTIN_ACTIONS } from "./registry.ts";
import { _signParentProps } from "./parentProps.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

/**
 * A `@reactive` prop is the parent's: it is set on every render from what the parent passes.
 * The browser used to be able to write one with `$set`, because the parent's new values were
 * delivered that way. Now the browser may not write one at all, unless it is also `@modelable`,
 * and the parent's values travel signed, for one child.
 */

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class PriceTag extends Component {
  @reactive amount = 0;
  @reactive currency = "EUR";
  @modelable note = "";
  @expose own = 0;
  override async render(): Promise<HtmlNode> {
    return { html: `<p>${this.amount} ${this.currency}</p>` };
  }
}

class Basket extends Component {
  @expose total = 12;
  override async render(): Promise<HtmlNode> {
    return await this.child(PriceTag, { key: "tag", props: { amount: this.total } });
  }
}

/** A PriceTag as the dispatcher restores it: its id is the one its snapshot carries. */
function restored(id = "basket-tag"): PriceTag {
  const tag = new PriceTag();
  tag._flowId = id;
  return tag;
}

describe("a client write to a @reactive prop", () => {
  it("is refused by $set and by a flow:model update", async () => {
    const tag = restored();
    tag.$set("amount", 999);
    expect(tag.amount).toBe(0);

    await tag._applyClientUpdate("amount", 999);
    expect(tag.amount).toBe(0);
  });

  it("is refused through the test harness too", async () => {
    const t = await FlowTest.mount(PriceTag);
    await t.update("currency", "XXX");
    expect(t.page().currency).toBe("EUR");
  });

  it("is still allowed for a @modelable prop and a plain @expose one", async () => {
    const tag = restored();
    await tag._applyClientUpdate("note", "gift");
    tag.$set("own", 3);
    expect(tag.note).toBe("gift");
    expect(tag.own).toBe(3);
  });
});

describe("the parent's values", () => {
  it("are rendered with a signature for that child", async () => {
    const t = await FlowTest.mount(Basket);
    const html = t.html();
    const json = JSON.stringify({ amount: 12 });
    const childId = /data-flow-id="([^"]+-tag)"/.exec(html)?.[1] ?? "";

    expect(childId).not.toBe("");
    expect(html).toContain(`data-flow-props-sig="${_signParentProps(childId, json)}"`);
  });

  it("are applied by the $props built-in when the signature verifies", async () => {
    expect(BUILTIN_ACTIONS.has("$props")).toBe(true);
    const tag = restored();
    const json = JSON.stringify({ amount: 40, currency: "USD" });

    await tag._applyParentProps(json, _signParentProps("basket-tag", json));

    expect(tag.amount).toBe(40);
    expect(tag.currency).toBe("USD");
  });

  it("are ignored when the JSON was changed, or was signed for another child", async () => {
    const signed = JSON.stringify({ amount: 40 });
    const sig = _signParentProps("basket-tag", signed);

    const tampered = restored();
    await tampered._applyParentProps(JSON.stringify({ amount: 1 }), sig);
    expect(tampered.amount).toBe(0);

    const other = restored("other-tag");
    await other._applyParentProps(signed, sig);
    expect(other.amount).toBe(0);

    const unsigned = restored();
    await unsigned._applyParentProps(signed, "");
    expect(unsigned.amount).toBe(0);
  });

  it("write only @reactive props, even when the parent's JSON names another field", async () => {
    const tag = restored();
    const json = JSON.stringify({ amount: 5, own: 77 });
    await tag._applyParentProps(json, _signParentProps("basket-tag", json));
    expect(tag.amount).toBe(5);
    expect(tag.own).toBe(0);
  });
});
