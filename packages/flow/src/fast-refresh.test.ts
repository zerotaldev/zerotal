import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import { BUILTIN_ACTIONS } from "./registry.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/**
 * `$rerender` (dev fast refresh) re-renders a component from its held snapshot WITHOUT
 * re-running onMount — so action-driven state is preserved and the newly-compiled render()
 * is applied. These tests cover that core semantic (the dispatch branch is a no-op that
 * just runs hydrate → render, which is what these assert).
 */
class CounterPage extends Component {
  @expose count = 0;
  @locked label = "start";
  mountRuns = 0;

  override async onMount(): Promise<void> {
    this.mountRuns++;
    this.count = 100; // onMount would reset action state — a rerender must NOT run it
    this.label = "mounted";
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>${this.label}: ${this.count}</p>` };
  }
}

const memo = { id: "c1", name: "CounterPage", path: "/t" } as const;

describe("$rerender — dev fast refresh", () => {
  it("is a recognised built-in action", () => {
    expect(BUILTIN_ACTIONS.has("$rerender")).toBe(true);
  });

  it("re-renders from the snapshot preserving state, without re-running onMount", async () => {
    // Simulate action-driven state (a user incremented past onMount's reset).
    const page = new CounterPage();
    page.count = 42;
    page.label = "live";
    const snap = dehydrate(page, memo);

    // A $rerender hydrates the held snapshot and renders — no onMount (the whole point).
    const restored = await hydrate(snap, CounterPage);
    const html = (await restored.render()).html;

    expect(html).toBe("<p>live: 42</p>"); // exact state preserved
    expect(restored.mountRuns).toBe(0); // onMount did NOT run
  });
});
