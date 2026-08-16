/** @jsxImportSource @zerotal/flow */
/**
 * Two pages linked by `flow:navigate`, sharing a layout, each carrying a child
 * island.
 *
 * **The shared layout is load-bearing.** `flow:navigate` only swaps in place
 * when both pages carry the same `[data-flow-layout]` marker; without one the
 * bridge falls back to a real browser navigation, which resets the document and
 * exercises none of the swap. A fixture missing it produces a test that passes
 * whatever the swap does.
 *
 * **The island is the bug.** A page-level snapshot is a direct child of
 * `<body>`, rendered after the body content, while a child island's sits inside
 * that content — so the two are in the opposite order from what a
 * document-order lookup would guess.
 */
import { Component } from "../../Component.ts";
import { Layout } from "../../Layout.ts";
import { expose } from "../../decorators.ts";
import type { HtmlNode } from "../../jsx-runtime.ts";

/** The persistent shell both pages share, so navigation between them stays in-place. */
export class NavLayout extends Layout {
  render(slot: HtmlNode) {
    return (
      <div data-flow-layout="NavLayout">
        <header id="shell">shell</header>
        <main>{slot}</main>
      </div>
    );
  }
}

/** A child, so the page renders a nested `<script id="flow-state-…">`. */
export class NavIsland extends Component {
  @expose label = "island";

  override async render() {
    return <span id={`island-${this.label}`}>{this.label}</span>;
  }
}

export class NavHomePage extends Component {
  static layout = NavLayout;

  @expose count = 0;

  @expose bump(): void {
    this.count += 1;
  }

  override async render() {
    return (
      <div>
        <h1 id="page">home</h1>
        <p id="count">{this.count}</p>
        {await this.child(NavIsland, { props: { label: "home" } })}
        <a id="to-about" href="/nav/about" flow:navigate>
          About
        </a>
        <button id="bump" type="button" onClick={this.bump}>
          Bump
        </button>
      </div>
    );
  }
}

export class NavAboutPage extends Component {
  static layout = NavLayout;

  @expose count = 0;

  @expose bump(): void {
    this.count += 1;
  }

  override async render() {
    return (
      <div>
        <h1 id="page">about</h1>
        <p id="count">{this.count}</p>
        {await this.child(NavIsland, { props: { label: "about" } })}
        <a id="to-home" href="/nav/home" flow:navigate>
          Home
        </a>
        <button id="bump" type="button" onClick={this.bump}>
          Bump
        </button>
      </div>
    );
  }
}
