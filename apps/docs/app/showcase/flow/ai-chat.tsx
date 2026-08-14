/** @jsxImportSource @zerotal/flow */
import { Component, expose, task } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Ai } from "@zerotal/ai";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

const CODE = `@expose prompt = "";
@expose answer = "";

@task async ask() {                       // streaming, cancellable, server-side
  this.answer = "";
  for await (const chunk of Ai.stream({
    prompt: this.prompt,
    system: "Answer in two or three sentences.",
    signal: this.signal,                  // $flow.cancel() aborts the generation
  })) {
    if (chunk.type === "text") this.answer += chunk.text;   // → streams to the browser
  }
}

<input bind={this.prompt} />
<button onClick={this.ask} loadingAttr="disabled">Ask</button>
<button onClick={() => $flow.cancel()} showOnLoading>Cancel</button>
<div text={this.answer} />`;

const SYSTEM =
  "You are answering inside a framework documentation demo. Answer in two or three " +
  "short sentences. No preamble, no bullet lists.";

/**
 * An AI chat page in twenty lines of component, with **no client JavaScript**.
 *
 * The interesting part is what is absent. There is no `/api/chat` route, no SSE
 * endpoint, no `EventSource`, no client state library, and no per-chunk
 * re-render. `@task` already streams a component field's writes to the browser
 * as they happen — a token stream is exactly the shape it was built for — so
 * `this.answer += chunk.text` in a server-side loop *is* the transport.
 *
 * Cancellation is the same story: `this.signal` is the `@task`'s AbortSignal,
 * `Ai.stream()` passes it to the provider, and `$flow.cancel()` from the browser
 * trips it. A user who closes the tab stops paying for tokens.
 */
export class AiChatPage extends Component {
  static title = "AI chat — Flow showcase";

  @expose prompt = "";
  @expose answer = "";
  @expose error = "";

  @task async ask(): Promise<void> {
    this.answer = "";
    this.error = "";

    const prompt = this.prompt.trim();
    if (!prompt) {
      this.error = "Type a question first.";
      return;
    }

    try {
      for await (const chunk of Ai.stream({ prompt, system: SYSTEM, signal: this.signal })) {
        if (chunk.type === "text") this.answer += chunk.text;
      }
    } catch (error) {
      // A demo that swallows this would be lying: the provider being
      // unreachable, out of quota, or declining the prompt is the normal
      // failure here, and the message is the useful part.
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">AI chat</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            A streaming chat page with{" "}
            <strong class="font-semibold text-slate-700">zero client JavaScript</strong>. No{" "}
            <code class="font-mono">/api/chat</code> route, no{" "}
            <code class="font-mono">EventSource</code>, no client state library — the tokens are a
            server-side loop writing to <code class="font-mono text-orange-600">this.answer</code>,
            and <code class="font-mono">@task</code> streams the field. Cancel aborts the generation
            itself, not just the UI.
          </p>
        </div>

        <Demo code={CODE}>
          <div class="flex gap-3">
            <input
              bind={this.prompt}
              placeholder="Ask something — e.g. what is a service container?"
              class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-orange-400"
            />
            <button
              onClick={this.ask}
              loadingAttr="disabled"
              class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
            >
              Ask
            </button>
            <button
              onClick={() => $flow.cancel()}
              showOnLoading
              class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:text-red-500"
            >
              Cancel
            </button>
          </div>

          <div
            text={this.answer}
            class="mt-5 min-h-28 whitespace-pre-wrap rounded-xl bg-slate-50 p-5 text-sm leading-relaxed text-slate-700"
          />

          <p text={this.error} class="mt-3 text-sm text-red-500" />
        </Demo>
      </div>
    );
  }
}
