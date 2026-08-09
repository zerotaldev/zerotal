/**
 * `onClick={this.submit}` where `submit` is not `@expose`d used to be pure silence.
 *
 * The allowlist is the set of exposed methods, so an undecorated method is simply absent
 * from it. Everything else passed: `tsc` clean, the compiler emitted `flow:click="submit"`,
 * the button rendered enabled, and the click sent a frame — which the server refused,
 * reporting the refusal *only* over the WebSocket to `console.error`. Nothing in the server
 * log, nothing thrown, no visual change. Indistinguishable from a broken binding, which is
 * where the time went.
 *
 * The compiler already has the member table. It now uses it.
 */
import { describe, it, expect } from "bun:test";
import { transformFlowFile, validateFlowFile } from "./transform.ts";

function page(body: string, members: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked, flow } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}

const compile = (body: string, members: string) =>
  transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx");

const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("a handler pointing at an un-@exposed method", () => {
  it("is a build error naming the method", () => {
    expect(() =>
      compile(`<button onClick={this.submit}>Send</button>`, "async submit() {}"),
    ).toThrow(/`submit` is used as a server action but is not @expose'd/);
  });

  it("says how to fix it", () => {
    let message = "";
    try {
      compile(`<button onClick={this.submit}>Send</button>`, "async submit() {}");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Add @expose to submit()");
    expect(message).toContain("demo.tsx");
  });

  it("catches it through the flow() form too", () => {
    expect(() =>
      compile(`<form onSubmit={flow(this.save).prevent}>x</form>`, "async save() {}"),
    ).toThrow(/not @expose'd/);
  });

  it("catches a non-click event as well", () => {
    expect(() => compile(`<input onBlur={this.check} />`, "async check() {}")).toThrow(
      /not @expose'd/,
    );
  });

  // The check has to live in the validation pass, not the transform. A transform error is
  // caught by the compiler orchestrator and downgraded to a runtime fallback, which would
  // leave the page rendering and the button still silently dead — the exact outcome being
  // fixed. `validateFlowFile` runs unconditionally (even on a cache hit) and propagates,
  // so the server refuses to start.
  it("is fatal through validateFlowFile, the path the server boots on", () => {
    expect(() =>
      validateFlowFile(page(`<button onClick={this.submit}>Send</button>`, "async submit() {}"), "/app/flow/pages/demo.tsx"),
    ).toThrow(/not @expose'd/);
  });

  it("lets a correct page through validateFlowFile untouched", () => {
    expect(() =>
      validateFlowFile(
        page(`<button onClick={this.submit}>Send</button>`, "@expose async submit() {}"),
        "/app/flow/pages/demo.tsx",
      ),
    ).not.toThrow();
  });
});

describe("what it must not reject", () => {
  it("accepts a properly exposed action", () => {
    const r = compile(`<button onClick={this.submit}>Send</button>`, "@expose async submit() {}");
    expect(html(r)).toContain('flow:click="submit"');
  });

  it("leaves an inherited handler alone", () => {
    // A base-class action or a mixin is invisible to this file's AST; guessing about it
    // would break pages the compiler cannot see the whole of.
    const r = compile(`<button onClick={this.inheritedAction}>x</button>`, "@expose x = 1;");
    expect(html(r)).toContain('flow:click="inheritedAction"');
  });

  it("leaves the client magics alone", () => {
    const r = compile(`<button onClick={this.refresh}>x</button>`, "@expose x = 1;");
    expect(html(r)).toContain('flow:click="refresh"');
  });

  // `@expose` is not the only decorator that puts a method in the allowlist. `@task`
  // registers into the same set — a streaming task is dispatched exactly like any other
  // action — and so does `@on`. Checking only for `@expose` rejected a valid page in this
  // repository's own showcase, which is how this was caught.
  it("accepts a @task method", () => {
    const r = compile(
      `<button onClick={this.generate}>Generate</button>`,
      "@expose answer = ''; @task async generate() {}",
    );
    expect(html(r)).toContain('flow:click="generate"');
  });

  it("accepts an @on listener, whose decorator takes arguments", () => {
    const r = compile(
      `<button onClick={this.sync}>Sync</button>`,
      "@expose x = 1; @on('refresh') async sync() {}",
    );
    expect(html(r)).toContain('flow:click="sync"');
  });
});
