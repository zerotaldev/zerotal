/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `// a child Component — its own state, snapshot, and update cycle
class CounterCard extends Component {
  @locked label = "Count";   // ← <CounterCard label="Likes" /> lands here; "Count" is the default
  @expose count = 0;
  @expose bump() { this.count++; }
  // …render()…
}

// three independent islands — bumping one doesn't re-render the others or the page
<CounterCard key="likes" label="Likes" />
<CounterCard key="views" label="Views" />
<CounterCard key="shares" label="Shares" />`;

/**
 * A nested child component — its own isolated state, snapshot, and update cycle.
 * Bumping one card does not re-render the other, or the parent (island architecture).
 */
class CounterCard extends Component {
  // Props from the parent land on the same-named fields; the initialisers are the defaults.
  @locked label = "Count";
  @locked accent = "text-orange-600";

  @expose count = 0;

  @expose bump(): void {
    this.count++;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-sm font-bold uppercase tracking-widest text-slate-400">{this.label}</p>
        <p text={this.count} class={"mt-2 text-5xl font-black tracking-tighter " + this.accent} />
        <button
          onClick={this.bump}
          loadingAttr="disabled"
          class="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-orange-300 hover:text-orange-600"
        >
          Bump this island
        </button>
      </div>
    );
  }
}

/** Nested components as independent islands on one page. */
export class IslandsPage extends Component {
  static title = "Islands — Flow showcase";

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Islands</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Each card below is a separate <code class="font-mono text-orange-600">Component</code>{" "}
            with its own state and its own WebSocket update cycle. Bump one and only that card
            re-renders — the other, and this page, are untouched. Props flow in through{" "}
            <code class="font-mono">setup()</code>.
          </p>
        </div>

        <Demo code={CODE}>
          <div class="grid gap-4 sm:grid-cols-3">
            <CounterCard key="likes" label="Likes" accent="text-orange-600" />
            <CounterCard key="views" label="Views" accent="text-sky-600" />
            <CounterCard key="shares" label="Shares" accent="text-emerald-600" />
          </div>

          <p class="mt-4 text-xs text-slate-400">
            Open the network tab: bumping a card sends a patch scoped to that island only.
          </p>
        </Demo>
      </div>
    );
  }
}
