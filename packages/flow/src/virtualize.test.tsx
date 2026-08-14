/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { Virtualize } from "./components.ts";

interface Row {
  id: number;
  name: string;
}

const rows = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, name: `Row ${from + i}` }));

const row = (r: Row) => ({ html: `<div class="row">${r.name}</div>` });

/** Pixel heights of the two spacers, in document order. */
function spacers(html: string): number[] {
  return [...html.matchAll(/height:(\d+)px" data-flow-virtualize-spacer/g)].map((m) =>
    Number(m[1]),
  );
}

describe("<Virtualize>", () => {
  it("renders only the supplied window, not the whole collection", () => {
    const html = Virtualize({
      items: rows(100, 20),
      start: 100,
      total: 10_000,
      itemHeight: 36,
      height: 480,
      children: row,
    }).html;

    expect(html.match(/class="row"/g)).toHaveLength(20);
    expect(html).toContain("Row 100");
    expect(html).toContain("Row 119");
    expect(html).not.toContain("Row 500");
  });

  it("sizes the spacers so the scrollbar reflects the full collection", () => {
    const html = Virtualize({
      items: rows(100, 20),
      start: 100,
      total: 1000,
      itemHeight: 36,
      height: 480,
      children: row,
    }).html;

    // 100 rows above, 880 below (1000 - 100 - 20), at 36px each.
    expect(spacers(html)).toEqual([3600, 31_680]);
  });

  it("collapses both spacers when the window is the whole collection", () => {
    const html = Virtualize({ items: rows(0, 5), itemHeight: 20, children: row }).html;
    expect(spacers(html)).toEqual([0, 0]);
  });

  it("never emits a negative bottom spacer when total is understated", () => {
    // `total` smaller than what `start + items.length` implies would otherwise
    // produce a negative height and an invalid style.
    const html = Virtualize({
      items: rows(0, 10),
      start: 5,
      total: 8,
      itemHeight: 20,
      children: row,
    }).html;

    expect(spacers(html)[1]).toBe(0);
    expect(html).not.toContain("height:-");
  });

  it("passes the absolute index to the row template", () => {
    const seen: number[] = [];
    Virtualize({
      items: rows(50, 3),
      start: 50,
      total: 900,
      itemHeight: 20,
      children: (r, i) => {
        seen.push(i);
        return row(r);
      },
    });

    // Indexes are positions in the collection, not in the window slice.
    expect(seen).toEqual([50, 51, 52]);
  });

  it("calls the window provider by name, with start and count", () => {
    function loadWindow(): void {}
    const html = Virtualize({
      items: rows(0, 10),
      total: 5000,
      itemHeight: 40,
      height: 400,
      onWindow: loadWindow,
      children: row,
    }).html;

    expect(html).toContain("$flow.loadWindow(s, c)");
  });

  it("omits the request entirely when no provider is given", () => {
    const html = Virtualize({ items: rows(0, 10), itemHeight: 40, children: row }).html;
    expect(html).not.toContain("$flow.");
    // The scroll handler still exists; it simply has nothing to ask for.
    expect(html).toContain("win()");
  });

  it("throttles scroll and listens passively", () => {
    const html = Virtualize({ items: rows(0, 4), itemHeight: 40, children: row }).html;
    // Passive so scrolling is never blocked; throttled because each call is a
    // potential round trip.
    expect(html).toContain("x-on:scroll.passive.throttle.100ms");
  });

  it("seeds its state from the window it was given", () => {
    const html = Virtualize({
      items: rows(300, 10),
      start: 300,
      total: 5000,
      itemHeight: 25,
      height: 500,
      overscan: 3,
      children: row,
    }).html;

    expect(html).toContain("h: 25");
    expect(html).toContain("o: 3");
    expect(html).toContain("at: 300");
    // 500 / 25 = 20 visible rows.
    expect(html).toContain("v: 20");
  });

  it("scrolls its own viewport at the configured height", () => {
    const html = Virtualize({ items: rows(0, 4), itemHeight: 40, height: 250, children: row }).html;
    expect(html).toContain("height:250px;overflow-y:auto");
    expect(html).toContain("data-flow-virtualize");
  });

  it("keeps at least one visible row for a viewport shorter than a row", () => {
    const html = Virtualize({ items: rows(0, 2), itemHeight: 90, height: 40, children: row }).html;
    expect(html).toContain("v: 1");
  });

  it("treats total as the window length when it is not given", () => {
    const html = Virtualize({ items: rows(0, 7), itemHeight: 10, children: row }).html;
    expect(spacers(html)).toEqual([0, 0]);
  });
});
