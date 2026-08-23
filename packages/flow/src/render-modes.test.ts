/** @jsxImportSource . */
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { expose } from "./decorators.ts";

/**
 * `static interactive = false` — the first rung of render modes.
 *
 * Every Flow component today is maximally interactive: rendered on the server,
 * dehydrated into a snapshot, tracked by the client, reachable over a socket.
 * That is right for a counter and wasteful for a nav rail. This adds the off
 * switch.
 *
 * The tests that matter are not "does it render". They are the three ways a
 * static child could quietly break the page it sits in, each of which comes from
 * the same place — the machinery that exists to *preserve* a live child's DOM is
 * exactly wrong for a child that has none:
 *
 * 1. **The stub.** A hydrated parent emits an already-known child as an empty
 *    `<div>` and trusts the client morph to leave the live DOM underneath alone.
 *    A static child has no live DOM, so a stub would blank the region on every
 *    parent update. Keeping it out of `_childIds` is what prevents that.
 * 2. **The morph skip.** The client morph skips any nested `[data-flow-root]`
 *    whose id is not the component being patched. A static child wearing that
 *    attribute would freeze at its first render, because its only route to an
 *    update is the parent re-rendering it.
 * 3. **The snapshot.** A state script for something the client never registers
 *    is bytes on every page load and a signed payload nobody reads.
 */

class StaticHeader extends Component {
  static override interactive = false;
  @expose label = "Home";
  override async render(): Promise<HtmlNode> {
    return { html: `<header>${this.label}</header>` };
  }
}

class LiveCounter extends Component {
  @expose count = 0;
  override async render(): Promise<HtmlNode> {
    return { html: `<div>${String(this.count)}</div>` };
  }
}

class Page extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<main></main>" };
  }
}

/** A parent, primed the way the framework primes one. */
function parent(): Page {
  const p = new Page();
  p._flowId = "page-abc";
  return p;
}

// `child()` dehydrates each interactive child, and dehydration signs the snapshot.
Bun.env["APP_KEY"] ??= "render-modes-test-key";

describe("static interactive = false", () => {
  it("renders its markup", async () => {
    const { html } = await parent().child(StaticHeader, { props: { label: "Docs" } });
    expect(html).toContain("<header>Docs</header>");
  });

  it("emits no state snapshot", async () => {
    const { html } = await parent().child(StaticHeader);
    // The script is the whole cost of interactivity on the wire, and a component
    // the client never registers has no use for one.
    expect(html).not.toContain("application/json");
    expect(html).not.toContain("flow-state-");
  });

  it("is not marked as a flow root", async () => {
    const { html } = await parent().child(StaticHeader);
    // `data-flow-root` is what makes the client morph skip a subtree. On something
    // whose only route to an update is its parent re-rendering it, that attribute
    // would freeze the content at the first render.
    expect(html).not.toContain("data-flow-root");
    expect(html).not.toContain("data-flow-id");
  });

  it("takes no place in the parent's child list", async () => {
    const p = parent();
    await p.child(StaticHeader);

    // `_childIds` is what decides whether a hydrated parent emits a stub. A stub
    // for a static child blanks the region, so it must never be a candidate.
    expect(p._childIds).toEqual([]);
  });

  it("is re-rendered in full by a hydrated parent, not stubbed", async () => {
    const p = parent();
    p._isHydrated = true;

    // Simulate the child having been seen before — the exact condition that
    // produces a stub for an interactive child.
    const first = await p.child(StaticHeader, { props: { label: "One" } });
    p._prevChildIds = [...p._childIds];
    const second = await p.child(StaticHeader, { props: { label: "Two" } });

    expect(first.html).toContain("One");
    expect(second.html).toContain("Two"); // not an empty stub
    expect(second.html).not.toBe(
      `<div data-flow-root x-data="{}" data-flow-id="" data-flow-name="StaticHeader"></div>`,
    );
  });

  it("does not shift the ids of its interactive siblings", async () => {
    const withStatic = parent();
    await withStatic.child(StaticHeader);
    await withStatic.child(LiveCounter);

    const withoutStatic = parent();
    await withoutStatic.child(LiveCounter);

    // A static child that counted toward the occurrence index would move every
    // interactive sibling's id the moment one was added above it — and a moved id
    // is a child that remounts and loses its state.
    expect(withStatic._childIds).toEqual(withoutStatic._childIds);
  });

  it("refuses to be lazy, deferred or streamed", async () => {
    // Each of those needs a client to ask for the real render. Silently ignoring
    // the option would leave a placeholder that never resolves.
    for (const opts of [{ lazy: true }, { defer: true }, { stream: true }]) {
      expect(parent().child(StaticHeader, opts)).rejects.toThrow(/cannot also be lazy/);
    }
  });
});

describe("isInteractive", () => {
  it("is false on a static component and true by default", () => {
    expect(new StaticHeader().isInteractive).toBe(false);
    expect(new LiveCounter().isInteractive).toBe(true);
  });
});

describe("an interactive child is unchanged", () => {
  it("still gets a root, an id and a snapshot", async () => {
    const p = parent();
    const { html } = await p.child(LiveCounter);

    expect(html).toContain("data-flow-root");
    expect(html).toContain("data-flow-id=");
    expect(html).toContain("application/json");
    expect(p._childIds).toHaveLength(1);
  });
});
