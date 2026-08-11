/**
 * A client expression that writes an `@expose` prop — `onClick={() => (this.selected =
 * row.id)}` — updates the reactive store, but `render()` runs on the server, so without
 * a round-trip the page never reflects the write and nothing errors. It *looked*
 * reactive whenever a later action happened to flush the pending write, which made the
 * failure intermittent. The bridge now records writes during expression evaluation and
 * syncs with one `$rerender` when the expression didn't dispatch an action of its own.
 *
 * These tests drive the recording seam directly (no DOM, no Alpine), matching
 * click-handling.test.ts.
 */
import { describe, it, expect } from "bun:test";
import { _beginExprEval, _endExprEval, _noteExprWrite, _countActionDispatch } from "./bridge.ts";

const comp = (id: string) => ({ id });

describe("client-expression write sync decision", () => {
  it("a write with no action dispatched needs a sync", () => {
    const c = comp("a");
    const token = _beginExprEval(c);
    _noteExprWrite("selected");
    expect(_endExprEval(c, token, 1)).toBe(true);
  });

  it("no writes → no sync, even with unrelated pending updates", () => {
    const c = comp("b");
    const token = _beginExprEval(c);
    expect(_endExprEval(c, token, 3)).toBe(false);
  });

  it("a write that leaves no pending change (toggled back) → no sync", () => {
    const c = comp("c");
    const token = _beginExprEval(c);
    _noteExprWrite("open");
    expect(_endExprEval(c, token, 0)).toBe(false);
  });

  it("an action dispatched on the same component suppresses the sync — its frame carries the writes", () => {
    const c = comp("d");
    const token = _beginExprEval(c);
    _noteExprWrite("selected");
    _countActionDispatch(c);
    expect(_endExprEval(c, token, 1)).toBe(false);
  });

  it("an action on a DIFFERENT component does not suppress — its frame carries nothing of ours", () => {
    const c = comp("e");
    const other = comp("f");
    const token = _beginExprEval(c);
    _noteExprWrite("selected");
    _countActionDispatch(other);
    expect(_endExprEval(c, token, 1)).toBe(true);
  });

  it("recording is inert outside an evaluation", () => {
    _noteExprWrite("stray"); // must not throw, must not leak into the next eval
    const c = comp("g");
    const token = _beginExprEval(c);
    expect(_endExprEval(c, token, 5)).toBe(false);
  });

  it("nested evaluations record independently and restore the outer set", () => {
    const outer = comp("h");
    const inner = comp("i");

    const outerToken = _beginExprEval(outer);
    _noteExprWrite("outerProp");

    const innerToken = _beginExprEval(inner);
    _noteExprWrite("innerProp");
    expect(_endExprEval(inner, innerToken, 1)).toBe(true);
    expect(innerToken.writes.has("outerProp")).toBe(false);

    // Back on the outer recording: a later write still lands there.
    _noteExprWrite("outerProp2");
    expect(_endExprEval(outer, outerToken, 1)).toBe(true);
    expect(outerToken.writes.has("innerProp")).toBe(false);
    expect(outerToken.writes.has("outerProp2")).toBe(true);
  });

  it("only actions dispatched during THIS evaluation suppress — earlier ones don't", () => {
    const c = comp("j");
    _countActionDispatch(c); // an action from some earlier interaction
    const token = _beginExprEval(c);
    _noteExprWrite("selected");
    expect(_endExprEval(c, token, 1)).toBe(true);
  });
});
