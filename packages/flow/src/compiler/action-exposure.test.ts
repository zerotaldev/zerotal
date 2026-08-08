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
import { transformFlowFile } from "./transform.ts";

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
});
