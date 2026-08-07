/**
 * What happens to a component whose action was in flight when the connection dropped.
 *
 * Flow's server is stateless per frame, so an action that completed has already committed
 * its database write — but if the patch never arrives, the client is still holding the
 * pre-action snapshot. The old behaviour released the ack and carried on: the in-memory half
 * was silently reverted while the persisted half stood, with nothing shown to the user, and
 * the next action built on state that no longer matched the server.
 *
 * The client cannot tell whether the action ran, and neither retrying nor discarding is
 * right. So it re-derives from the server on reconnect — which is correct either way.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { _resyncInternals } from "./client/bridge.ts";

/** Records which components were asked to refresh; `missing` are treated as unmounted. */
function refresher(missing: string[] = []) {
  const refreshed: string[] = [];
  return {
    refreshed,
    fn: (id: string): boolean => {
      if (missing.includes(id)) return false;
      refreshed.push(id);
      return true;
    },
  };
}

beforeEach(() => _resyncInternals.clear());

describe("a component left mid-action is marked for resync", () => {
  it("records the component rather than letting it carry on quietly", () => {
    _resyncInternals.markStale("counter-1");
    expect(_resyncInternals.isStale("counter-1")).toBe(true);
  });

  it("refreshes every marked component on drain", () => {
    _resyncInternals.markStale("counter-1");
    _resyncInternals.markStale("cart-2");

    const r = refresher();
    const resynced = _resyncInternals.drain(r.fn);

    expect(resynced.sort()).toEqual(["cart-2", "counter-1"]);
    expect(r.refreshed.sort()).toEqual(["cart-2", "counter-1"]);
  });

  it("drains exactly once — a second reconnect does not re-refresh", () => {
    _resyncInternals.markStale("counter-1");
    _resyncInternals.drain(refresher().fn);

    const second = refresher();
    expect(_resyncInternals.drain(second.fn)).toEqual([]);
    expect(second.refreshed).toEqual([]);
  });

  it("skips a component that has since left the page", () => {
    _resyncInternals.markStale("counter-1");
    _resyncInternals.markStale("gone-9");

    const r = refresher(["gone-9"]);
    expect(_resyncInternals.drain(r.fn)).toEqual(["counter-1"]);
  });

  it("does nothing when nothing was in flight", () => {
    const r = refresher();
    expect(_resyncInternals.drain(r.fn)).toEqual([]);
    expect(r.refreshed).toEqual([]);
  });

  it("re-marks a component whose own resync is abandoned", () => {
    // The set is cleared before refreshing, so a $refresh that is itself dropped can mark
    // the component again — clearing afterwards would have wiped that and lost the state
    // permanently.
    _resyncInternals.markStale("counter-1");
    _resyncInternals.drain((id) => {
      _resyncInternals.markStale(id); // the resync frame is dropped too
      return true;
    });

    expect(_resyncInternals.isStale("counter-1")).toBe(true);
  });

  it("does not accumulate duplicates for the same component", () => {
    _resyncInternals.markStale("counter-1");
    _resyncInternals.markStale("counter-1");
    expect(_resyncInternals.size()).toBe(1);
  });
});
