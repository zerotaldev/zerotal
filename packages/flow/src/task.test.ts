import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import { task, expose, getTaskMethods } from "./decorators.ts";
import { getAllowedMethods } from "./registry.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

class StreamPage extends Component {
  @expose answer = "";
  @expose other = "";

  @task
  async summarize(): Promise<void> {
    this.answer = "";
    for (const tok of ["a", "b", "c"]) {
      if (this.cancelled) break;
      this.answer += tok;
    }
  }

  @expose
  plain(): void {
    this.other = "done";
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<div>${this.answer}</div>` };
  }
}

describe("@task", () => {
  it("registers the method as a task and auto-@exposes it (callable from the browser)", () => {
    const p = new StreamPage(); // method decorators register via addInitializer on construction
    const tasks = getTaskMethods(p.constructor as { prototype: object });
    expect(tasks.has("summarize")).toBe(true);
    expect(tasks.has("plain")).toBe(false);

    // Auto-exposed → in the callable allowlist alongside the plain @expose method.
    const allowed = getAllowedMethods(p.constructor as unknown as typeof Component);
    expect(allowed.has("summarize")).toBe(true);
    expect(allowed.has("plain")).toBe(true);
  });

  it("signal is inert outside a running task (never aborts); cancelled is false", () => {
    const p = new StreamPage();
    expect(p.signal.aborted).toBe(false);
    expect(p.cancelled).toBe(false);
  });

  it("reflects the dispatcher's abort signal — cancelled flips when aborted", () => {
    const p = new StreamPage();
    const controller = new AbortController();
    p._taskSignal = controller.signal; // the dispatcher attaches this for the task's duration
    expect(p.cancelled).toBe(false);

    controller.abort();
    expect(p.cancelled).toBe(true);
    expect(p.signal.aborted).toBe(true);
  });

  it("a task observes cancellation cooperatively (loop breaks early)", async () => {
    const p = new StreamPage();
    const controller = new AbortController();
    p._taskSignal = controller.signal;
    controller.abort(); // already cancelled before it runs

    await p.summarize();
    expect(p.answer).toBe(""); // broke out before appending any token
  });

  it("runs to completion when not cancelled", async () => {
    const p = new StreamPage();
    await p.summarize();
    expect(p.answer).toBe("abc");
  });

  it("the task signal is cleared back to inert after the dispatcher detaches it", () => {
    const p = new StreamPage();
    const controller = new AbortController();
    p._taskSignal = controller.signal;
    controller.abort();
    expect(p.cancelled).toBe(true);

    p._taskSignal = null; // dispatcher's finally block detaches it
    expect(p.cancelled).toBe(false);
    expect(p.signal.aborted).toBe(false);
  });
});
