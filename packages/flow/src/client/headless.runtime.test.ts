import { describe, it, expect } from "bun:test";
import {
  flowRadioGroup,
  flowListbox,
  flowCombobox,
  flowField,
  flowTabs,
  flowFileUpload,
  flowMenu,
} from "./headless.ts";

// Build a live context: methods (from the factory) inherited, $flow/$el own props.
function ctx<T extends object>(factory: T, extra: Record<string, unknown>): any {
  return Object.assign(Object.create(factory), extra);
}

function mockGel(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    $get: (k: string) => store[k],
    $set: (k: string, v: unknown) => {
      store[k] = v;
    },
  };
}

// Minimal fake element exposing a fixed set of [role="option"] / [role="radio"].
function fakeEl(role: string, values: unknown[]) {
  const nodes = values.map((v) => ({
    getAttribute: (a: string) => (a === "data-value" ? JSON.stringify(v) : null),
    focus() {
      (this as any)._focused = true;
    },
    click() {
      (this as any)._clicked = true;
    },
  }));
  return {
    nodes,
    querySelectorAll: (sel: string) => (sel.includes(role) ? nodes : []),
    querySelector: () => null,
  };
}

describe("flowRadioGroup", () => {
  it("select() writes the value through $flow.$set", () => {
    const flow = mockGel({ plan: "free" });
    const c = ctx(flowRadioGroup({ name: "plan" }), { $flow: flow });
    c.select("pro");
    expect(flow.store["plan"]).toBe("pro");
  });

  it("onKey ArrowDown focuses + clicks the next radio (wrapping)", () => {
    const el = fakeEl("radio", ["a", "b", "c"]);
    const c = ctx(flowRadioGroup({ name: "plan" }), { $flow: mockGel(), $el: el });
    let prevented = false;
    c.onKey({
      key: "ArrowDown",
      target: el.nodes[2],
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect((el.nodes[0] as any)._focused).toBe(true); // wrapped from last → first
    expect((el.nodes[0] as any)._clicked).toBe(true);
  });
});

describe("flowListbox", () => {
  it("isSelected reflects single + multiple selection", () => {
    const single = ctx(flowListbox({ name: "x" }), { $flow: mockGel({ x: 2 }) });
    expect(single.isSelected(2)).toBe(true);
    expect(single.isSelected(1)).toBe(false);

    const multi = ctx(flowListbox({ name: "x", multiple: true }), {
      $flow: mockGel({ x: [1, 3] }),
    });
    expect(multi.isSelected(1)).toBe(true);
    expect(multi.isSelected(2)).toBe(false);
  });

  it("single select sets value and closes", () => {
    const flow = mockGel({ x: null });
    const c = ctx(flowListbox({ name: "x" }), { $flow: flow, $el: { querySelector: () => null } });
    c.open = true;
    c.select(5);
    expect(flow.store["x"]).toBe(5);
    expect(c.open).toBe(false);
  });

  it("multiple select toggles membership", () => {
    const flow = mockGel({ x: [1] });
    const c = ctx(flowListbox({ name: "x", multiple: true }), { $flow: flow });
    c.select(2);
    expect(flow.store["x"]).toEqual([1, 2]);
    c.select(1);
    expect(flow.store["x"]).toEqual([2]);
  });

  it("move() wraps the active highlight over the option count", () => {
    const el = fakeEl("option", ["a", "b", "c"]);
    const c = ctx(flowListbox({ name: "x" }), { $flow: mockGel(), $el: el });
    c.active = 2;
    c.move(1);
    expect(c.active).toBe(0); // wrapped
    c.move(-1);
    expect(c.active).toBe(2); // wrapped back
  });

  it("openList highlights the selected option", () => {
    const el = fakeEl("option", ["a", "b", "c"]);
    const c = ctx(flowListbox({ name: "x" }), { $flow: mockGel({ x: "b" }), $el: el });
    c.openList();
    expect(c.open).toBe(true);
    expect(c.active).toBe(1);
  });
});

// Fake options carrying data-value, data-label, and a toggleable display.
function comboEl(rows: { value: unknown; label: string; hidden?: boolean }[]) {
  const nodes = rows.map((r) => ({
    style: { display: r.hidden ? "none" : "" },
    hidden: false,
    getAttribute: (a: string) =>
      a === "data-value" ? JSON.stringify(r.value) : a === "data-label" ? r.label : null,
    textContent: r.label,
  }));
  return { nodes, querySelectorAll: () => nodes };
}

describe("flowCombobox", () => {
  it("client select sets value + query label and closes", () => {
    const flow = mockGel({ pick: null });
    const c = ctx(flowCombobox({ name: "pick" }), { $flow: flow });
    c.open = true;
    c.select(2, "Josh");
    expect(flow.store["pick"]).toBe(2);
    expect(c.query).toBe("Josh"); // client mode mirrors label into the input
    expect(c.open).toBe(false);
  });

  it("server select sets value + writes label to the query prop", () => {
    const flow = mockGel({ cityId: null, search: "" });
    const c = ctx(flowCombobox({ name: "cityId", queryName: "search" }), { $flow: flow });
    c.select(10, "Oslo");
    expect(flow.store["cityId"]).toBe(10);
    expect(flow.store["search"]).toBe("Oslo");
  });

  it("selectEl reads data-value/data-label off the option element", () => {
    const flow = mockGel({ pick: null });
    const c = ctx(flowCombobox({ name: "pick" }), { $flow: flow });
    const el = comboEl([{ value: 7, label: "Sam" }]).nodes[0];
    c.selectEl(el);
    expect(flow.store["pick"]).toBe(7);
    expect(c.query).toBe("Sam");
  });

  it("move skips hidden (filtered-out) options", () => {
    const el = comboEl([
      { value: "a", label: "A" },
      { value: "b", label: "B", hidden: true }, // filtered out
      { value: "c", label: "C" },
    ]);
    const c = ctx(flowCombobox({ name: "x" }), { $flow: mockGel(), $el: el });
    c.active = 0;
    c.move(1);
    expect(c.active).toBe(2); // skipped the hidden index 1
  });

  it("onInput (client) sets the query and opens", () => {
    const el = comboEl([{ value: "a", label: "Apple" }]);
    const c = ctx(flowCombobox({ name: "x" }), { $flow: mockGel(), $el: el });
    c.onInput({ target: { value: "ap" } } as any);
    expect(c.query).toBe("ap");
    expect(c.open).toBe(true);
  });
});

describe("flowField", () => {
  function node(init: any = {}) {
    const store: Record<string, string> = {};
    return {
      id: init.id || "",
      style: init.style || { display: "" },
      textContent: init.textContent ?? "",
      _store: store,
      getAttribute: (k: string) => (k in store ? store[k] : null),
      setAttribute: (k: string, v: string) => {
        store[k] = v;
      },
    };
  }
  function fieldRoot(parts: { control: any; label?: any; desc?: any; err?: any }) {
    return {
      querySelector(sel: string) {
        if (sel === "label") return parts.label ?? null;
        if (sel.includes("data-flow-description")) return parts.desc ?? null;
        if (sel.includes("error")) return parts.err ?? null;
        return parts.control;
      },
    };
  }
  it("wires id / for / aria-describedby and aria-invalid from the error", () => {
    const control = node(),
      label = node(),
      desc = node(),
      err = node({ textContent: "Required" });
    const c = ctx(flowField(), { $el: fieldRoot({ control, label, desc, err }) });
    c.init();
    expect(control.id).toMatch(/^flow-field-/);
    expect(label._store["for"]).toBe(control.id);
    expect(control._store["aria-describedby"]).toContain(desc.id);
    expect(control._store["aria-describedby"]).toContain(err.id);
    expect(control._store["aria-invalid"]).toBe("true");
  });
  it("aria-invalid is false when the error is empty", () => {
    const control = node(),
      err = node({ textContent: "" });
    const c = ctx(flowField(), { $el: fieldRoot({ control, err }) });
    c.init();
    expect(control._store["aria-invalid"]).toBe("false");
  });
});

describe("flowTabs", () => {
  it("ArrowRight focuses + clicks the next tab (wrapping)", () => {
    const el = fakeEl("tab", ["a", "b", "c"]);
    const c = ctx(flowTabs({ tab: "a" }), { $el: el });
    c.onKey({ key: "ArrowRight", target: el.nodes[2], preventDefault() {} });
    expect((el.nodes[0] as any)._clicked).toBe(true);
  });
});

describe("flowField cleanup", () => {
  it("destroy() disconnects the MutationObserver (no leak on morph removal)", () => {
    let disconnected = false;
    const c: any = Object.create(flowField());
    c._observer = {
      disconnect() {
        disconnected = true;
      },
    };
    c.destroy();
    expect(disconnected).toBe(true);
    expect(c._observer).toBe(null);
  });
});

describe("flowMenu", () => {
  it("opens to first item, arrows/Home/End move, Escape closes + refocuses trigger", () => {
    let active: any = null;
    const mk = (id: string) => {
      const item = {
        id,
        focus: () => {
          active = item;
        },
      };
      return item;
    };
    const items = [mk("a"), mk("b"), mk("c")];
    const trigger = mk("trigger");
    const menu = { querySelectorAll: () => items };
    const $el = {
      querySelector: (sel: string) =>
        sel.includes("menu") ? menu : sel.includes("haspopup") ? trigger : null,
    };
    const g: any = globalThis as any;
    g.document = {
      get activeElement() {
        return active;
      },
    };

    const c = ctx(flowMenu(), { $el, $nextTick: (fn: () => void) => fn() });
    c.openMenu(false);
    expect(c.open).toBe(true);
    expect(active).toBe(items[0]);
    c.onKey({ key: "ArrowDown", preventDefault() {} });
    expect(active).toBe(items[1]);
    c.onKey({ key: "End", preventDefault() {} });
    expect(active).toBe(items[2]);
    c.onKey({ key: "ArrowDown", preventDefault() {} });
    expect(active).toBe(items[0]); // wraps
    c.onKey({ key: "ArrowUp", preventDefault() {} });
    expect(active).toBe(items[2]); // wraps back
    c.onKey({ key: "Escape", preventDefault() {} });
    expect(c.open).toBe(false);
    expect(active).toBe(trigger);
  });
});

describe("flowFileUpload", () => {
  it("tracks upload events for its key and cleans up listeners on destroy", () => {
    const listeners: Record<string, EventListener[]> = {};
    const g: any = globalThis as any;
    const origAdd = g.window?.addEventListener,
      origRemove = g.window?.removeEventListener;
    g.window = {
      addEventListener: (e: string, h: EventListener) => {
        (listeners[e] ??= []).push(h);
      },
      removeEventListener: (e: string, h: EventListener) => {
        listeners[e] = (listeners[e] ?? []).filter((x) => x !== h);
      },
    };
    const fire = (e: string, detail: any) =>
      (listeners[e] ?? []).forEach((h) => h({ detail } as any));

    const c: any = Object.create(flowFileUpload({ name: "photo" }));
    c._handlers = [];
    c.init();

    fire("flow:upload-start", { key: "photo", count: 1 });
    expect(c.uploading).toBe(true);
    fire("flow:upload-progress", { key: "photo", percent: 42 });
    expect(c.progress).toBe(42);
    fire("flow:upload-progress", { key: "other", percent: 99 }); // different field → ignored
    expect(c.progress).toBe(42);
    fire("flow:upload-error", { key: "photo", error: "too big" });
    expect(c.uploading).toBe(false);
    expect(c.error).toBe("too big");

    // The success path — the one this block used to skip entirely, which is how
    // the listener came to be bound to an event name (`flow:upload-done`) that
    // nothing dispatches. A successful upload left `uploading` true forever and
    // the dropzone stuck on "Uploading… 100%".
    //
    // The name here must stay in step with `_uploadFiles` in client/bridge.ts.
    fire("flow:upload-start", { key: "photo", count: 1 });
    expect(c.uploading).toBe(true);
    fire("flow:upload-finish", { key: "photo" });
    expect(c.uploading).toBe(false);
    expect(c.progress).toBe(100);

    // Another field finishing must not clear this one's indicator.
    fire("flow:upload-start", { key: "photo", count: 1 });
    fire("flow:upload-finish", { key: "other" });
    expect(c.uploading).toBe(true);
    fire("flow:upload-finish", { key: "photo" });
    expect(c.uploading).toBe(false);

    const before = Object.values(listeners).reduce((n, a) => n + a.length, 0);
    expect(before).toBeGreaterThan(0);
    c.destroy();
    const after = Object.values(listeners).reduce((n, a) => n + a.length, 0);
    expect(after).toBe(0);

    if (origAdd) {
      g.window.addEventListener = origAdd;
      g.window.removeEventListener = origRemove;
    }
  });
});
