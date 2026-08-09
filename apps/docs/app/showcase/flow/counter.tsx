/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `@expose count = 0;

@expose increment() {   // a server action — round-trips, patches back
  this.count++;
}

// server action (method reference)
<button onClick={this.increment} loadingAttr="disabled">+ Server</button>
// client expressions (arrow fns) — instant, no round-trip
<button onClick={() => this.count++}>+ Client</button>
<button onClick={() => this.count--}>− Client</button>
// reactive text + class, client-side
<p text={this.count} class={this.count > 5 ? "text-orange-600" : ""} />`;

/**
 * Server actions vs client expressions. `onClick={this.increment}` round-trips to the
 * server; `onClick={() => this.count--}` updates the DOM instantly with no round-trip.
 * The colour is a reactive class binding — also client-side, no round-trip.
 */
export class CounterPage extends Component {
  static title = "Counter — Flow showcase";

  @expose count = 0;
  @expose serverBumps = 0;

  @expose increment(): void {
    this.count++;
    this.serverBumps++;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const btn =
      "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-orange-300 hover:text-orange-600";

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Counter</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            One button is a <strong>server action</strong> (a method reference — it round-trips over
            the socket, runs on the server, patches the DOM back). The others are{" "}
            <strong>client expressions</strong> (arrow functions — they update the browser
            instantly). You write the difference exactly as you would in React.
          </p>
        </div>

        <Demo code={CODE}>
          <p
            text={this.count}
            class={
              this.count > 5
                ? "text-6xl font-black tracking-tighter text-orange-600"
                : "text-6xl font-black tracking-tighter text-slate-900"
            }
          />
          <p class="mt-1 text-xs text-slate-400">
            Turns orange past 5 — via a reactive <code class="font-mono">class</code> binding, no
            round-trip.
          </p>

          <div class="mt-6 flex flex-wrap gap-3">
            <button onClick={this.increment} loadingAttr="disabled" class={btn}>
              + Server action
            </button>
            <button onClick={() => this.count++} class={btn}>
              + Client (instant)
            </button>
            <button onClick={() => this.count--} class={btn}>
              − Client (instant)
            </button>
            <button onClick={() => (this.count = 0)} class={btn}>
              Reset (client)
            </button>
          </div>

          <p class="mt-6 text-sm text-slate-500">
            The server has processed{" "}
            <span class="font-semibold text-slate-900">{this.serverBumps}</span> server-action bump
            {this.serverBumps === 1 ? "" : "s"}. Client-only changes never reach it — until your
            next server action flushes them, where the server reconciles and stays authoritative.
          </p>
        </Demo>
      </div>
    );
  }
}
