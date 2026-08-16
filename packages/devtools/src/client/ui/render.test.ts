/**
 * The keyed reconciler, against a fake node tree.
 *
 * There is no DOM in this runtime and the monorepo carries no DOM
 * implementation — adding one for a dev-only package would cost every install
 * and every CI run. The reconciler needs only six of `Node`'s members, so the
 * test brings them: what is being checked is the algorithm's bookkeeping, which
 * is where a list diff goes wrong, not the browser's.
 */
import { describe, it, expect } from "bun:test";
import { reconcile } from "./render.ts";

/** The slice of `Element` that {@link reconcile} touches. */
class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly kids: FakeEl[] = [];
  parent: FakeEl | null = null;

  constructor(readonly label = "") {}

  get children(): FakeEl[] {
    return this.kids;
  }
  get firstChild(): FakeEl | null {
    return this.kids[0] ?? null;
  }
  get nextSibling(): FakeEl | null {
    if (!this.parent) return null;
    return this.parent.kids[this.parent.kids.indexOf(this) + 1] ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  remove(): void {
    const at = this.parent?.kids.indexOf(this) ?? -1;
    if (at >= 0) this.parent!.kids.splice(at, 1);
    this.parent = null;
  }
  insertBefore(node: FakeEl, ref: FakeEl | null): FakeEl {
    node.remove();
    node.parent = this;
    const at = ref ? this.kids.indexOf(ref) : -1;
    if (at >= 0) this.kids.splice(at, 0, node);
    else this.kids.push(node);
    return node;
  }
}

/** `reconcile` against the shim, with the cast confined to one place. */
function run(
  host: FakeEl,
  items: string[],
  onCreate?: (item: string) => void,
  onUpdate?: (item: string) => void,
): void {
  reconcile(
    host as unknown as HTMLElement,
    items,
    (item) => item,
    (item) => {
      onCreate?.(item);
      return new FakeEl(item) as unknown as HTMLElement;
    },
    (_el, item) => onUpdate?.(item),
  );
}

const labels = (host: FakeEl): string[] => host.kids.map((k) => k.label);

describe("reconcile", () => {
  it("fills an empty host in order", () => {
    const host = new FakeEl();
    run(host, ["a", "b", "c"]);
    expect(labels(host)).toEqual(["a", "b", "c"]);
  });

  it("keeps the same nodes across an unchanged render", () => {
    // The whole point: a redraw that changes nothing must touch nothing, or the
    // scroll position and text selection go with it.
    const host = new FakeEl();
    run(host, ["a", "b"]);
    const before = [...host.kids];
    const created: string[] = [];
    run(host, ["a", "b"], (i) => created.push(i));
    expect(created).toEqual([]);
    expect(host.kids[0]).toBe(before[0]!);
    expect(host.kids[1]).toBe(before[1]!);
  });

  it("creates only the new row when one arrives at the front", () => {
    // A request arriving is one insert, not a rebuilt list.
    const host = new FakeEl();
    run(host, ["b", "c"]);
    const kept = host.kids[0]!;
    const created: string[] = [];
    run(host, ["a", "b", "c"], (i) => created.push(i));
    expect(created).toEqual(["a"]);
    expect(labels(host)).toEqual(["a", "b", "c"]);
    expect(host.kids[1]).toBe(kept);
  });

  it("removes the rows that left", () => {
    const host = new FakeEl();
    run(host, ["a", "b", "c"]);
    run(host, ["a", "c"]);
    expect(labels(host)).toEqual(["a", "c"]);
  });

  it("moves rather than rebuilds on a reorder", () => {
    const host = new FakeEl();
    run(host, ["a", "b", "c"]);
    const a = host.kids[0]!;
    const created: string[] = [];
    run(host, ["c", "b", "a"], (i) => created.push(i));
    expect(created).toEqual([]);
    expect(labels(host)).toEqual(["c", "b", "a"]);
    expect(host.kids[2]).toBe(a);
  });

  it("updates the survivors and only the survivors", () => {
    const host = new FakeEl();
    run(host, ["a", "b"]);
    const updated: string[] = [];
    run(host, ["a", "c"], undefined, (i) => updated.push(i));
    expect(updated).toEqual(["a"]);
  });

  it("empties the host when the list does", () => {
    const host = new FakeEl();
    run(host, ["a", "b"]);
    run(host, []);
    expect(labels(host)).toEqual([]);
  });

  it("clears an unkeyed child the host wrote itself", () => {
    // The All tab writes "no requests match this filter" straight into the row
    // host; without this the message would sit above the rows that replaced it.
    const host = new FakeEl();
    const message = new FakeEl("empty-state");
    host.insertBefore(message, null);
    run(host, ["a"]);
    expect(labels(host)).toEqual(["a"]);
  });

  it("handles a list replaced wholesale", () => {
    const host = new FakeEl();
    run(host, ["a", "b"]);
    run(host, ["x", "y", "z"]);
    expect(labels(host)).toEqual(["x", "y", "z"]);
  });
});
