import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked, reactive, modelable } from "./decorators.ts";
import {
  getReactiveProps,
  getModelableProps,
  getExposedProps,
  getLockedProps,
} from "./decorators.ts";
import { dehydrate } from "./dehydrate.ts";
import { FlowTest } from "./testing.ts";
import { jsx } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class Child extends Component {
  @reactive step = 1;
  @modelable value = "";
  @expose own = 0;
  override async render(): Promise<HtmlNode> {
    return { html: `<p>step:${this.step} value:${this.value}</p>` };
  }
}

class Parent extends Component {
  @expose body = "hello";
  override async render(): Promise<HtmlNode> {
    return await this.child(Child, { props: { step: 5, value: this.body } });
  }
}

describe("@reactive / @modelable — decorator registration", () => {
  it("registers reactive + modelable props (modelable implies reactive)", () => {
    new Child(); // trigger field initializers → decorator registration
    const reactiveKeys = getReactiveProps(Child.prototype);
    const modelableKeys = getModelableProps(Child.prototype);
    expect(reactiveKeys.has("step")).toBe(true);
    expect(reactiveKeys.has("value")).toBe(true); // modelable is reactive too
    expect(modelableKeys.has("value")).toBe(true);
    expect(modelableKeys.has("step")).toBe(false);
  });

  it("reactive/modelable props are exposed but NOT locked (so the framework can push values)", () => {
    const c = new Child();
    const exposed = getExposedProps(c);
    const locked = getLockedProps(c);
    expect(exposed.has("step")).toBe(true);
    expect(exposed.has("value")).toBe(true);
    expect(locked.has("step")).toBe(false);
    expect(locked.has("value")).toBe(false);
  });

  it("serializes reactive/modelable props into the snapshot, unlocked", () => {
    const c = new Child();
    c.step = 7;
    c.value = "hi";
    const snap = dehydrate(c, { id: "c1", name: "Child", path: "/t" });
    expect(snap.data["step"]![0]).toBe(7);
    expect(snap.data["value"]![0]).toBe("hi");
    expect(snap.data["step"]![1]["locked"]).toBeUndefined(); // client-settable
  });
});

describe("child() — emits parent→child bindings", () => {
  it("emits data-flow-props (reactive values) and data-flow-model (modelable→parent map)", async () => {
    const t = await FlowTest.mount(Parent);
    const html = t.html();

    // reactive prop values the parent passed
    expect(html).toContain("data-flow-props=");
    expect(html).toContain('"step":5');
    expect(html).toContain('"value":"hello"');

    // modelable child prop `value` resolves to the parent's `body` property
    expect(html).toContain("data-flow-model=");
    expect(html).toContain('"value":"body"');

    // the child still rendered its content
    expect(html).toContain("step:5 value:hello");
  });
});

class LazyChild extends Component {
  mounted = false;
  override async onMount(): Promise<void> {
    this.mounted = true;
  }
  override placeholder(): HtmlNode {
    return { html: "<span>loading…</span>" };
  }
  override async render(): Promise<HtmlNode> {
    return { html: `<p>child mounted: ${this.mounted}</p>` };
  }
}
class LazyParent extends Component {
  override async render(): Promise<HtmlNode> {
    return jsx(LazyChild, { lazy: true }) as HtmlNode;
  }
}

describe("child() — lazy prop via JSX", () => {
  it("`<Child lazy />` renders a placeholder and defers onMount", async () => {
    const t = await FlowTest.mount(LazyParent);
    const html = t.html();
    expect(html).toContain("data-flow-lazy"); // child root marked for viewport mount
    expect(html).toContain("loading…"); // placeholder shown
    expect(html).not.toContain("child mounted"); // render()/onMount did NOT run yet
  });
});

describe("teleport — prop emission", () => {
  it('compiles teleport="body" to flow:teleport (runtime path)', () => {
    const node = jsx("div", { teleport: "body", children: "modal" }) as HtmlNode;
    expect(node.html).toContain('flow:teleport="body"');
    expect(node.html).toContain("modal");
  });
});

describe("confirm — prop emission", () => {
  it("compiles a string to flow:confirm (plain message)", () => {
    const node = jsx("button", {
      "flow:click": "del",
      confirm: "Delete this?",
      children: "Delete",
    }) as HtmlNode;
    expect(node.html).toContain('flow:confirm="Delete this?"');
  });

  it("compiles {message,prompt} to the legacy flow:confirm.prompt encoding", () => {
    const node = jsx("button", {
      "flow:click": "del",
      confirm: { message: "Type the name", prompt: "acme/web" },
    }) as HtmlNode;
    expect(node.html).toContain('flow:confirm.prompt="Type the name|acme/web"');
  });

  it("compiles a rich object to flow:confirm.opts JSON (danger → variant)", () => {
    const node = jsx("button", {
      "flow:click": "del",
      confirm: {
        title: "Delete project",
        message: "This can't be undone.",
        danger: true,
        confirm: "Delete",
      },
    }) as HtmlNode;
    const m = node.html.match(/flow:confirm\.opts="([^"]*)"/);
    expect(m).not.toBeNull();
    // Attribute value is HTML-escaped JSON — decode the entities before parsing.
    const json = m![1]!
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'");
    expect(JSON.parse(json)).toEqual({
      message: "This can't be undone.",
      title: "Delete project",
      confirmLabel: "Delete",
      variant: "danger",
    });
  });
});

describe("decorator guards — no @expose/@locked on a getter", () => {
  // A getter (@computed, or any accessor) has no writable snapshot storage, so exposing or
  // locking it would serialize a value the framework then writes back on update, clobbering
  // the getter. TS already rejects this; the runtime guard catches it when Bun runs without
  // typechecking. We call the decorators directly with an accessor context.
  const accessorCtx = (kind: string, name: string) =>
    ({ kind, name, addInitializer() {} }) as unknown as Parameters<typeof expose>[1];

  it("@expose throws on a getter", () => {
    expect(() => expose(() => 1, accessorCtx("getter", "uptime"))).toThrow(/getter/);
  });

  it("@locked throws on a getter", () => {
    expect(() => locked(() => 1, accessorCtx("getter", "uptime") as never)).toThrow(/getter/);
  });

  it("@expose still accepts a field and a method", () => {
    expect(() => expose(0, accessorCtx("field", "count"))).not.toThrow();
    expect(() => expose(() => {}, accessorCtx("method", "save"))).not.toThrow();
  });
});
