import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { dehydrate, hydrate, encodeSnapshotDelta, applySnapshotDelta } from "./dehydrate.ts";
import type { Snapshot } from "./types.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/** A data-heavy component: a small filter/page + a large @locked list that rarely changes. */
class GridPage extends Component {
  @expose filter = "";
  @expose page = 1;
  @locked rows: { id: number; name: string }[] = [];
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

const memo = { id: "g1", name: "GridPage", path: "/t" } as const;

describe("encodeSnapshotDelta", () => {
  it("includes only the changed field and excludes the large unchanged list", () => {
    const c = new GridPage();
    c.rows = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `row-${i}` }));
    const prev = dehydrate(c, memo);

    c.filter = "acme"; // change one small @expose field; rows untouched
    const next = dehydrate(c, memo);

    const delta = encodeSnapshotDelta(prev, next);
    expect(Object.keys(delta.dataDelta).sort()).toEqual(["filter"]);
    expect(delta.dataDelta["rows"]).toBeUndefined(); // 50-row list not re-sent
    expect(delta.dataRemoved).toEqual([]);
  });

  it("is empty when nothing changed", () => {
    const c = new GridPage();
    const snap = dehydrate(c, memo);
    const delta = encodeSnapshotDelta(snap, snap);
    expect(Object.keys(delta.dataDelta)).toEqual([]);
    expect(delta.dataRemoved).toEqual([]);
  });

  it("reports removed keys", () => {
    const prev: Snapshot = {
      data: { a: [1, {}], b: [2, {}] },
      memo: { ...memo, children: [] },
      checksum: "x",
    };
    const next: Snapshot = { data: { a: [1, {}] }, memo: { ...memo, children: [] }, checksum: "y" };
    const delta = encodeSnapshotDelta(prev, next);
    expect(delta.dataRemoved).toEqual(["b"]);
    expect(Object.keys(delta.dataDelta)).toEqual([]);
  });
});

describe("delta round-trip — reconstruction + checksum verification", () => {
  it("applySnapshotDelta reproduces the full snapshot value-for-value", () => {
    const c = new GridPage();
    c.rows = [{ id: 1, name: "a" }];
    const prev = dehydrate(c, memo);
    c.filter = "x";
    c.page = 3;
    const next = dehydrate(c, memo);

    const recon = applySnapshotDelta(prev, encodeSnapshotDelta(prev, next));
    expect(JSON.stringify(recon.data)).toBe(JSON.stringify(next.data));
    expect(recon.checksum).toBe(next.checksum);
  });

  it("the reconstructed snapshot passes HMAC verification (hydrate succeeds)", async () => {
    const c = new GridPage();
    c.rows = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `r${i}` }));
    const prev = dehydrate(c, memo);
    c.filter = "typescript";
    const next = dehydrate(c, memo);

    // Client-side path: rebuild from prev + delta, then the server verifies it next action.
    const recon = applySnapshotDelta(prev, encodeSnapshotDelta(prev, next));
    const restored = await hydrate(recon, GridPage);

    expect(restored.filter).toBe("typescript");
    expect(restored.rows.length).toBe(20);
  });

  it("survives repeated hops sending the reconstructed snapshot back (the live loop)", async () => {
    // Mirrors the client/server exchange: SSR snapshot → action → delta → client rebuild →
    // that rebuilt snapshot is what the NEXT action sends, and the server must verify it.
    const seed = new GridPage();
    seed.rows = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `r${i}`, email: `e${i}` }));
    let clientSnap = dehydrate(seed, memo);

    for (let hop = 1; hop <= 5; hop++) {
      // Server: verify the client's snapshot, run an action that mutates state, re-dehydrate.
      const page = await hydrate(clientSnap, GridPage); // throws if the checksum fails
      page.filter = `hop-${hop}`;
      page.page = hop;
      // Mutate the @locked array too (mirrors addItem/reorder on the directives page).
      page.rows = [{ id: 100 + hop, name: `new-${hop}`, email: `n${hop}@x.io` }, ...page.rows];
      const next = dehydrate(page, memo);

      // Wire: delta relative to the client's snapshot.
      const delta = encodeSnapshotDelta(clientSnap, next);

      // Client: rebuild and adopt as the snapshot it will send next hop.
      clientSnap = applySnapshotDelta(clientSnap, delta);
      expect(JSON.stringify(clientSnap.data)).toBe(JSON.stringify(next.data));
    }
  });

  it("pipelining hazard: an out-of-order delta corrupts state; an in-order one verifies", async () => {
    // Why the client must serialize round-trips per component. Two actions dispatched
    // against the SAME base S, each touching a DIFFERENT field, are the failure case.
    const c = new GridPage();
    const S = dehydrate(c, memo); // filter="", page=1

    const a = await hydrate(S, GridPage);
    a.filter = "search";
    const deltaA = encodeSnapshotDelta(S, dehydrate(a, memo)); // {filter}

    const b = await hydrate(S, GridPage);
    b.page = 2;
    const deltaB = encodeSnapshotDelta(S, dehydrate(b, memo)); // {page}

    // Pipelined (the OLD bug): apply deltaB — which was diffed against S — on top of the
    // snapshot deltaA already advanced. The result carries BOTH fields, but its checksum
    // (deltaB's) only covers page=2 with filter="". HMAC rejects it → "Invalid snapshot".
    const corrupted = applySnapshotDelta(applySnapshotDelta(S, deltaA), deltaB);
    await expect(hydrate(corrupted, GridPage)).rejects.toThrow();

    // Serialized (the fix): apply A, then diff B against A's result before applying it.
    const afterA = applySnapshotDelta(S, deltaA);
    const b2 = await hydrate(afterA, GridPage); // verifies — afterA is a valid snapshot
    b2.page = 2;
    const clean = applySnapshotDelta(afterA, encodeSnapshotDelta(afterA, dehydrate(b2, memo)));
    const restored = await hydrate(clean, GridPage); // verifies
    expect(restored.filter).toBe("search");
    expect(restored.page).toBe(2);
  });

  it("a tampered delta value fails verification (signing still protects state)", async () => {
    const c = new GridPage();
    const prev = dehydrate(c, memo);
    c.filter = "ok";
    const next = dehydrate(c, memo);
    const delta = encodeSnapshotDelta(prev, next);

    // Forge the field but keep the server checksum → reconstruction no longer matches.
    delta.dataDelta["filter"] = ["hacked", {}];
    const recon = applySnapshotDelta(prev, delta);
    await expect(hydrate(recon, GridPage)).rejects.toThrow();
  });
});
