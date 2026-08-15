/** @jsxImportSource . */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Component, _resetKeylessWarnings } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { expose, reactive } from "./decorators.ts";
// TEMP DIAGNOSTIC — remove with the fix.
import { getReactiveProps, getModelableProps } from "./decorators.ts";

/**
 * A keyless child's id must be content-addressed, not positional.
 *
 * The old id was `<parentId>-<name>-<occurrence index>`. An index is *position*,
 * and position is not identity: remove the first item of a list and every row
 * below it inherits the id its neighbour had. That matters because a hydrated
 * parent emits an already-known child as an **empty stub**, on the understanding
 * that the client morph will recognise the pairing — so every row adopts the
 * previous row's live DOM and the last one is left blank.
 *
 * Nothing warns, and no server-side test can see it: SSR and `FlowTest` render
 * the full child every time, because they never take the
 * `_isHydrated && _prevChildIds.includes(childId)` branch. These tests inspect
 * the ids directly, which is the only place the failure is visible without a
 * browser.
 */

class Row extends Component {
  @expose settingKey = "";
  override async render(): Promise<HtmlNode> {
    return { html: `<div>${this.settingKey}</div>` };
  }
}

class Counter extends Component {
  @reactive count = 0;
  override async render(): Promise<HtmlNode> {
    return { html: `<div>${String(this.count)}</div>` };
  }
}

class Notice extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: `<div>notice</div>` };
  }
}

/** Render a parent's children and return the ids it assigned, in order. */
async function idsFor(build: (parent: Component) => Promise<void>): Promise<string[]> {
  const parent = new Row();
  parent._flowId = "page-abc";
  await build(parent);
  return [...parent._childIds];
}

// `child()` dehydrates each child, and dehydration signs the snapshot.
Bun.env["APP_KEY"] ??= "child-keys-test-key";

beforeEach(() => _resetKeylessWarnings());
afterEach(() => _resetKeylessWarnings());

describe("keyless child ids", () => {
  it("stay attached to the row's own props when an item is removed from the front", async () => {
    const before = await idsFor(async (p) => {
      for (const k of ["alpha", "beta", "gamma"]) await p.child(Row, { props: { settingKey: k } });
    });
    const after = await idsFor(async (p) => {
      for (const k of ["beta", "gamma"]) await p.child(Row, { props: { settingKey: k } });
    });

    // The two rows that survived keep the ids they had. Under index keys `beta`
    // would have inherited `alpha`'s id and `gamma` would have inherited
    // `beta`'s — every row wearing its neighbour's DOM.
    expect(after[0]).toBe(before[1]!);
    expect(after[1]).toBe(before[2]!);
  });

  it("are unaffected by a conditional sibling of another class appearing above", async () => {
    const without = await idsFor(async (p) => {
      for (const k of ["a", "b"]) await p.child(Row, { props: { settingKey: k } });
    });
    const withNotice = await idsFor(async (p) => {
      await p.child(Notice);
      for (const k of ["a", "b"]) await p.child(Row, { props: { settingKey: k } });
    });

    expect(withNotice.slice(1)).toEqual(without);
  });

  it("differ between siblings with different props", async () => {
    const ids = await idsFor(async (p) => {
      for (const k of ["a", "b", "c"]) await p.child(Row, { props: { settingKey: k } });
    });
    expect(new Set(ids).size).toBe(3);
  });

  it("do not depend on the order the props object was written in", async () => {
    const one = await idsFor(async (p) => {
      await p.child(Row, { props: { settingKey: "a", extra: 1 } as never });
    });
    const two = await idsFor(async (p) => {
      await p.child(Row, { props: { extra: 1, settingKey: "a" } as never });
    });
    expect(one).toEqual(two);
  });

  it("still disambiguate two genuinely identical siblings", async () => {
    const ids = await idsFor(async (p) => {
      await p.child(Row, { props: { settingKey: "same" } });
      await p.child(Row, { props: { settingKey: "same" } });
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ignore @reactive props, so a parent-pushed change does not remount the child", async () => {
    // The whole point of a @reactive prop is to update the child in place. If it
    // fed the id, `<Counter count={n} />` would get a new id — and therefore a
    // fresh island — on every increment.
    const at0 = await idsFor(async (p) => {
      await p.child(Counter, { props: { count: 0 } });
    });
    const at7 = await idsFor(async (p) => {
      await p.child(Counter, { props: { count: 7 } });
    });
    // TEMP DIAGNOSTIC — remove with the fix. Says whether the drain registered
    // `count` as reactive by the time `child()` asked, which is the difference
    // between a registration bug and an id-derivation bug.
    console.log(
      `DIAG2 reactive(Counter)=${JSON.stringify([...getReactiveProps(Counter.prototype)])} ` +
        `modelable(Counter)=${JSON.stringify([...getModelableProps(Counter.prototype)])} ` +
        `ownKeys=${JSON.stringify(Object.keys(new Counter()).slice(-3))}`,
    );
    expect(at7).toEqual(at0);
  });

  it("leave an explicit key exactly as given", async () => {
    const ids = await idsFor(async (p) => {
      await p.child(Row, { key: "bs-branch", props: { settingKey: "x" } });
    });
    expect(ids[0]).toBe("page-abc-row-bs-branch");
  });
});

describe("keyless children with identical props", () => {
  it("warn once, naming the class and the fix", async () => {
    const seen: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));

    try {
      await idsFor(async (p) => {
        for (let i = 0; i < 5; i++) await p.child(Row);
      });
    } finally {
      console.warn = original;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("<Row>");
    expect(seen[0]).toContain("key");
  });

  it("say nothing when the props tell the siblings apart", async () => {
    const seen: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));

    try {
      await idsFor(async (p) => {
        for (const k of ["a", "b", "c"]) await p.child(Row, { props: { settingKey: k } });
      });
    } finally {
      console.warn = original;
    }

    expect(seen).toEqual([]);
  });
});
