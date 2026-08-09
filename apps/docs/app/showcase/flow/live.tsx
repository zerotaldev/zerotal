/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, computed } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `@locked now = "";
@locked ticks = 0;
@expose paused = false;

@expose tick() {
  this.now = new Date().toLocaleTimeString();
  this.ticks++;
}
@computed get uptime() {   // derived; renders as a static server value
  return \`\${this.ticks * 2}s\`;
}

// poll calls the action on an interval → the component re-renders with fresh state
{!this.paused && <div poll={{ every: "2s", action: this.tick }} />}
<p>{this.now} · {this.ticks} ticks · uptime {this.uptime}</p>`;

/**
 * Server-driven polling. A `poll` directive calls a server action on an interval, so the
 * component re-renders with fresh server state — a live clock, a dashboard tile, a queue
 * depth — with no client timer code. `@computed` derives values on the server per render.
 */
export class LivePage extends Component {
  static title = "Live & polling — Flow showcase";

  @locked now = "";
  @locked ticks = 0;
  @expose paused = false;

  override async onMount(): Promise<void> {
    this.tick();
  }

  @expose tick(): void {
    this.now = new Date().toLocaleTimeString("en-GB");
    this.ticks++;
  }

  @computed get uptime(): string {
    const secs = this.ticks * 2;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Live &amp; polling</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            The clock ticks from the <strong>server</strong>: a{" "}
            <code class="font-mono text-orange-600">poll</code> directive calls an action every two
            seconds and the component re-renders with fresh state — no client timer, no fetch. Pause
            it to stop the interval.
          </p>
        </div>

        <Demo code={CODE}>
          {/* The poll element only renders while not paused, so toggling `paused` stops it. */}
          {!this.paused && <div poll={{ every: "2s", action: this.tick }} />}

          <p class="font-mono text-5xl font-black tracking-tighter text-slate-900">{this.now}</p>
          <p class="mt-2 text-sm text-slate-500">
            Server time · {this.ticks} ticks · uptime {this.uptime}
            <span showOnLoading class="ml-2 text-orange-500">
              updating…
            </span>
          </p>

          <div class="mt-6 flex gap-3">
            <button
              onClick={() => (this.paused = !this.paused)}
              class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-orange-300 hover:text-orange-600"
            >
              <span show={this.paused}>Resume</span>
              <span x-show="!$flow.paused">Pause</span>
            </button>
            <button
              onClick={this.tick}
              loadingAttr="disabled"
              class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600"
            >
              Tick now
            </button>
          </div>
        </Demo>
      </div>
    );
  }
}
