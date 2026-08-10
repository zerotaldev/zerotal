/**
 * Scroll position across `flow:navigate`.
 *
 * The bug: the SPA swap replaced the page under a stationary viewport and never
 * touched the scroll offset. Following a link from near the bottom of a long
 * list left you halfway down the next page — which reads as the page having
 * failed to load, because nothing you can see has changed.
 *
 * A real navigation does two things this has to reproduce: forward goes to the
 * top (or to the fragment, if the href names one), and Back returns you to where
 * you were. The decision between those is what these tests cover; the DOM calls
 * that carry it out are a couple of lines with no branching, and this suite runs
 * without a DOM.
 */
import { describe, it, expect } from "bun:test";
import { _hashOf, _scrollIntent, _scrollAction } from "./bridge.ts";

describe("which scroll a navigation asks for", () => {
  it("goes to the top by default — the bug this fixes", () => {
    expect(_scrollIntent({})).toBe("top");
  });

  it("stays put when the caller opts out", () => {
    // <Link preserveScroll> / $flow.navigateCurrent({ preserveScroll: true }) —
    // a filter or sort control partway down a page, not a link somewhere else.
    expect(_scrollIntent({ preserveScroll: true })).toBe("preserve");
  });

  it("restores a recorded position on Back, even against preserveScroll", () => {
    // The popstate handler passes `preserveScroll: restore === undefined`, so
    // both arrive together. The recorded position has to win, or Back would
    // leave the viewport wherever the previous page happened to be.
    expect(_scrollIntent({ restoreScroll: [0, 1400] })).toEqual([0, 1400]);
    expect(_scrollIntent({ restoreScroll: [0, 1400], preserveScroll: true })).toEqual([0, 1400]);
  });

  it("treats the top of the page as a real position, not a missing one", () => {
    // [0, 0] is falsy-looking in every way that matters to a `||`. Going Back to
    // a page the user had not scrolled must still put them at the top.
    expect(_scrollIntent({ restoreScroll: [0, 0], preserveScroll: true })).toEqual([0, 0]);
  });
});

describe("what that intent resolves to", () => {
  it("scrolls to the origin for a plain forward navigation", () => {
    expect(_scrollAction("top", "")).toEqual({ kind: "offset", left: 0, top: 0 });
  });

  it("does nothing at all when preserving", () => {
    // Not "scroll to where we already are" — no scroll call is made, so a
    // smooth-scrolling page isn't nudged and no scroll event is synthesised.
    expect(_scrollAction("preserve", "")).toEqual({ kind: "none" });
    expect(_scrollAction("preserve", "section-3")).toEqual({ kind: "none" });
  });

  it("restores the exact offset it was given", () => {
    expect(_scrollAction([120, 4300], "")).toEqual({ kind: "offset", left: 120, top: 4300 });
  });

  it("prefers the fragment over the top of the page", () => {
    expect(_scrollAction("top", "pricing")).toEqual({ kind: "fragment", id: "pricing" });
  });

  it("ignores the fragment when restoring — the recorded offset is the answer", () => {
    // Back to /docs#intro from further down: the user's position is where they
    // were reading, not where the fragment points.
    expect(_scrollAction([0, 900], "intro")).toEqual({ kind: "offset", left: 0, top: 900 });
  });

  it("decodes a percent-encoded fragment", () => {
    expect(_scrollAction("top", "getting%20started")).toEqual({
      kind: "fragment",
      id: "getting started",
    });
  });

  it("takes a malformed escape literally rather than throwing", () => {
    // decodeURIComponent("%zz") throws URIError. Browsers fall back to the raw
    // fragment; throwing here would abort the swap's scroll entirely.
    expect(_scrollAction("top", "%zz")).toEqual({ kind: "fragment", id: "%zz" });
  });
});

describe("reading the fragment off an href", () => {
  it("finds one", () => {
    expect(_hashOf("/docs#install")).toBe("install");
  });

  it("reports none for an href without one", () => {
    expect(_hashOf("/docs")).toBe("");
    expect(_hashOf("/docs?q=a&b=c")).toBe("");
  });

  it("keeps everything after the first #", () => {
    expect(_hashOf("/docs#a#b")).toBe("a#b");
  });

  it("survives a bare or trailing #", () => {
    expect(_hashOf("/docs#")).toBe("");
    expect(_hashOf("#top")).toBe("top");
  });

  it("is not confused by a # inside the query string", () => {
    expect(_hashOf("/search?q=%23tag#results")).toBe("results");
  });
});
