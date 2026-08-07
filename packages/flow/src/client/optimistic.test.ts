import { describe, it, expect } from "bun:test";
import { applyAppend, applyRemove, reapply, opProps, type OptOp } from "./optimistic.ts";

describe("optimistic reconciliation core", () => {
  it("applyAppend adds an item, idempotently on the same reference", () => {
    const item = { id: "tmp", text: "hi" };
    const once = applyAppend([{ id: 1 }], item);
    expect(once).toHaveLength(2);
    expect(once.at(-1)).toBe(item);
    // Re-applying the same reference doesn't duplicate it.
    expect(applyAppend(once, item)).toHaveLength(2);
  });

  it("applyRemove drops every matching item", () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(applyRemove(arr, (x) => (x as { id: number }).id === 2)).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it("reapply layers pending ops onto a fresh server snapshot (survives an interim patch)", () => {
    const optItem = { id: "tmp-1", text: "optimistic" };
    const ops: OptOp[] = [
      { prop: "todos", kind: "append", item: optItem },
      { prop: "done", kind: "remove", match: (x) => (x as { id: number }).id === 9 },
    ];
    // A broadcast patch arrives with the server's current arrays (no optimistic item yet).
    const server = { todos: [{ id: 1 }], done: [{ id: 9 }, { id: 10 }] };
    const out = reapply(server, ops);

    expect(out.todos).toEqual([{ id: 1 }, optItem]); // optimistic append preserved
    expect(out.done).toEqual([{ id: 10 }]); // optimistic remove preserved
    // Pure — inputs untouched.
    expect(server.todos).toEqual([{ id: 1 }]);
  });

  it("reapply is idempotent once the server has caught up (no duplicate)", () => {
    const optItem = { id: "tmp", text: "x" };
    const ops: OptOp[] = [{ prop: "todos", kind: "append", item: optItem }];
    // Server already includes the exact optimistic reference (e.g. re-applied twice).
    const server = { todos: [{ id: 1 }, optItem] };
    expect(reapply(server, ops).todos).toEqual([{ id: 1 }, optItem]);
  });

  it("skips ops for missing or non-array props", () => {
    const ops: OptOp[] = [{ prop: "ghost", kind: "append", item: { id: 1 } }];
    expect(reapply({ real: [] }, ops)).toEqual({ real: [] });
  });

  it("opProps returns the distinct props touched", () => {
    const ops: OptOp[] = [
      { prop: "a", kind: "append", item: 1 },
      { prop: "a", kind: "remove", match: () => false },
      { prop: "b", kind: "append", item: 2 },
    ];
    expect(opProps(ops).sort()).toEqual(["a", "b"]);
  });
});
