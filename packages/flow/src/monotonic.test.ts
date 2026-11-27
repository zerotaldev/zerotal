import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked, getMonotonicProps } from "./decorators.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import {
  MONOTONIC_FIELD,
  FlowSnapshotReplayError,
  _claimMonotonic,
  _resetMonotonicStore,
  setMonotonicStore,
  type MonotonicStore,
} from "./monotonic.ts";
import type { Snapshot } from "./types.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

/**
 * `@locked` stops the browser editing a value, not rewinding it: any snapshot issued to the user
 * in the last twelve hours verifies, so an earlier copy of the page's state can be sent back and
 * acted on again. `@locked({ monotonic: true })` accepts only a component's newest snapshot.
 *
 * The first version kept its counters in the session. Two frames sent at once each loaded their
 * own copy of the session, so both passed; and with the default cookie session the browser held
 * the counters, so they never moved on a socket and an old snapshot could be replayed.
 */

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});
beforeEach(() => _resetMonotonicStore());

class Wallet extends Component {
  @locked({ monotonic: true }) balance = 100;
  @expose amount = 10;

  @expose spend(): void {
    this.balance -= this.amount;
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>${this.balance}</p>` };
  }
}

class Plain extends Component {
  @locked balance = 100;
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

let seq = 0;

/** A first render of Wallet: its snapshot, as a GET issues it. */
function firstRender(): Snapshot {
  const page = new Wallet();
  page._flowId = `wallet-${++seq}`;
  return dehydrate(page, { id: page._flowId, name: "Wallet", path: "/wallet" });
}

/** Build the page a frame carrying `snapshot` runs on, and claim its sequence. */
async function arrive(snapshot: Snapshot) {
  const page = await hydrate(snapshot, Wallet);
  page._flowId = snapshot.memo.id; // as dispatch does, from the signed memo
  const claim = await _claimMonotonic(snapshot, true, page);
  return { page, claim: claim! };
}

/** The snapshot the action sends back. */
function reply(page: Wallet, snapshot: Snapshot): Snapshot {
  return dehydrate(page, snapshot.memo);
}

describe("@locked({ monotonic: true })", () => {
  it("is off for a plain @locked field", () => {
    expect(getMonotonicProps(Plain.prototype).size).toBe(0);
    const page = new Plain();
    page._flowId = "plain";
    expect(dehydrate(page, { id: "plain", name: "Plain", path: "/" }).data[MONOTONIC_FIELD]).toBe(
      undefined,
    );
  });

  it("accepts each snapshot once, and the one sent back after it", async () => {
    const first = firstRender();
    const a = await arrive(first);
    a.page.spend();
    const second = reply(a.page, first);
    await a.claim.settle(a.page, false);

    expect(String(second.data[MONOTONIC_FIELD]?.[0])).toContain(":2:");
    const b = await arrive(second);
    await b.claim.settle(b.page, false);

    // The first snapshot again, and the second again: both refused.
    await expect(arrive(first)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
    await expect(arrive(second)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("runs one of two frames sent at once with the same snapshot", async () => {
    // A store whose reads take a moment, so both frames read before either writes.
    const inner = new Map<string, number>();
    const slow: MonotonicStore = {
      epoch: "slow",
      async get(key) {
        await Bun.sleep(5);
        return inner.get(key);
      },
      compareAndSet(key, expected, next) {
        if (inner.get(key) !== expected) return false;
        if (next === undefined) inner.delete(key);
        else inner.set(key, next);
        return true;
      },
    };
    setMonotonicStore(slow);
    const snapshot = firstRender();

    const results = await Promise.allSettled([arrive(snapshot), arrive(snapshot)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("gives the claim back when the action failed and sent no snapshot", async () => {
    const snapshot = firstRender();
    const a = await arrive(snapshot);
    await a.claim.settle(a.page, true); // refused or thrown: the browser still holds `snapshot`

    const retry = await arrive(snapshot);
    await retry.claim.settle(retry.page, false);
    await expect(arrive(snapshot)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("keeps the claim of an action that succeeded with no snapshot sent back", async () => {
    // A redirect: the action ran, so its snapshot must not run it again.
    const snapshot = firstRender();
    const a = await arrive(snapshot);
    await a.claim.settle(a.page, false);
    await expect(arrive(snapshot)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("keeps the claim of a failed action that still sent a snapshot back", async () => {
    const snapshot = firstRender();
    const a = await arrive(snapshot);
    const sent = reply(a.page, snapshot); // the page re-rendered its errors
    await a.claim.settle(a.page, true);

    await expect(arrive(snapshot)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
    const next = await arrive(sent);
    expect(next.page.balance).toBe(100);
  });

  it("refuses a snapshot issued before the store's counters were lost", async () => {
    const snapshot = firstRender();
    _resetMonotonicStore(); // a restart: a new in-process store, with a new epoch
    await expect(arrive(snapshot)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("refuses a snapshot without the field, or whose sequence names another component", async () => {
    const snapshot = firstRender();
    const without: Snapshot = { ...snapshot, data: { ...snapshot.data } };
    delete without.data[MONOTONIC_FIELD];
    const page = new Wallet();
    page._flowId = snapshot.memo.id;
    await expect(_claimMonotonic(without, true, page)).rejects.toBeInstanceOf(
      FlowSnapshotReplayError,
    );

    // Another component's sequence carried under this one's id.
    const moved: Snapshot = { ...snapshot, memo: { ...snapshot.memo, id: "someone-else" } };
    await expect(_claimMonotonic(moved, true, page)).rejects.toBeInstanceOf(
      FlowSnapshotReplayError,
    );
  });

  it("reads the same value however often the snapshot reads it", () => {
    const page = new Wallet();
    page._flowId = "twice";
    const a = dehydrate(page, { id: "twice", name: "Wallet", path: "/" });
    const b = dehydrate(page, { id: "twice", name: "Wallet", path: "/" });
    expect(a.data[MONOTONIC_FIELD]).toEqual(b.data[MONOTONIC_FIELD]);
  });
});
