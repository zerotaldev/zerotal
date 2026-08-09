/** @jsxImportSource @zerotal/flow */
import { Component, expose, task } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `@expose answer = "";

@task async generate() {   // streams field writes as they happen
  this.answer = "";
  for await (const token of llm.stream(this.prompt, { signal: this.signal })) {
    if (this.cancelled) break;
    this.answer += token;   // → streams to the browser live
  }
}

<button onClick={this.generate} loadingAttr="disabled">Generate</button>
<button onClick={() => $flow.cancel()} showOnLoading>Cancel</button>
// bind the field reactively — updates token-by-token, no per-chunk re-render
<div text={this.answer} />`;

const SAMPLE =
  "Flow streams a long-running action's field writes to the browser as they happen. " +
  "Because the field is part of the signed snapshot, the framework flushes throttled " +
  "field-level diffs while the task runs — no second endpoint, no client state library, " +
  "no per-chunk re-render. This is the shape an AI answer, a build log, or a progress feed " +
  "usually needs, here in one server method with cooperative cancellation built in.";

/**
 * Streaming `@task`. The method writes `this.answer` in a loop; the framework streams those
 * field writes to the browser live (bound reactively with `text={this.answer}`). The control
 * keeps its loading state for the whole run, and `$flow.cancel()` aborts it out-of-band.
 * The token source here is a canned string on a timer — swap it for `llm.stream(...)`.
 */
export class StreamingPage extends Component {
  static title = "Streaming @task — Flow showcase";

  @expose answer = "";

  @task async generate(): Promise<void> {
    this.answer = "";
    const words = SAMPLE.split(" ");
    for (const word of words) {
      if (this.cancelled) break;
      await new Promise((resolve) => setTimeout(resolve, 70));
      this.answer += (this.answer ? " " : "") + word;
    }
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Streaming @task</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Click Generate: the text below fills in word-by-word as the server writes the field in a
            loop. That's <code class="font-mono text-orange-600">@task</code> streaming field-level
            diffs — no <code class="font-mono">flow:stream</code> element, no re-render per chunk.
            Cancel aborts it mid-run.
          </p>
        </div>

        <Demo code={CODE}>
          <div class="flex gap-3">
            <button
              onClick={this.generate}
              loadingAttr="disabled"
              class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
            >
              Generate
            </button>
            <button
              onClick={() => $flow.cancel()}
              showOnLoading
              class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:text-red-500"
            >
              Cancel
            </button>
            <span showOnLoading class="flex items-center text-sm text-slate-400">
              streaming…
            </span>
          </div>

          <div
            text={this.answer}
            class="mt-5 min-h-28 rounded-xl bg-slate-50 p-5 font-mono text-sm leading-relaxed text-slate-700"
          />
        </Demo>
      </div>
    );
  }
}
