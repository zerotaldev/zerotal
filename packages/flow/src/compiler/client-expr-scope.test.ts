/**
 * Client expressions are emitted as source text with `this.` rewritten to `$flow.`,
 * so any other identifier is shipped verbatim and evaluates against the browser's
 * scope. A handler that closed over a server-side loop variable therefore threw a
 * ReferenceError inside the bridge's evaluator — logged to the browser console,
 * swallowed everywhere else. The page looked perfect and the button did nothing.
 *
 * Two fixes are asserted here: the common shape now compiles to a real server action
 * with `data-args`, and anything still unreachable is a build error that names the
 * identifier instead of a dead control at runtime.
 */
import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

function page(body: string, members: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}

const compile = (body: string, members: string) =>
  transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx");

const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("loop-variable handlers compile to a server action with arguments", () => {
  it("emits flow:click + data-args for () => this.method(loopVar)", () => {
    const r = compile(
      `<div>{this.rows.map((row) => <button onClick={() => this.remove(row.id)}>x</button>)}</div>`,
      "@locked rows = []; @expose async remove(_id) {}",
    );

    const out = html(r);
    expect(out).toContain('flow:click="remove"');
    expect(out).toContain("data-args=");
    expect(out).toContain("JSON.stringify([row.id])");
    // The broken verbatim form must be gone.
    expect(out).not.toContain("$flow.remove(row.id)");
  });

  it("passes several arguments through in order", () => {
    const r = compile(
      `<div>{this.rows.map((row, i) => <button onClick={() => this.move(row.id, i)}>m</button>)}</div>`,
      "@locked rows = []; @expose async move(_id, _i) {}",
    );

    expect(html(r)).toContain("JSON.stringify([row.id, i])");
  });

  it("leaves an argument that reads this as a live client expression", () => {
    // `this.count + 1` must re-evaluate against reactive client state, not be frozen
    // into the markup at render time.
    const r = compile(
      `<button onClick={() => this.setTo(this.count + 1)}>+</button>`,
      "@expose count = 0; @expose async setTo(_n) {}",
    );

    const out = html(r);
    expect(out).toContain("$flow.setTo($flow.count + 1)");
    expect(out).not.toContain("data-args=");
  });

  it("leaves a no-argument handler as a plain action", () => {
    const r = compile(`<button onClick={this.save}>Save</button>`, "@expose async save() {}");

    const out = html(r);
    expect(out).toContain('flow:click="save"');
    expect(out).not.toContain("data-args=");
  });

  it("does not treat a client magic as a server action", () => {
    // `this.dispatch(…)` is a client callback magic (the bridge aliases the bare name),
    // so it must stay an inline client expression rather than becoming a dispatched
    // server action with data-args.
    const r = compile(`<button onClick={() => this.dispatch('ping')}>p</button>`, "@expose x = 1;");

    const out = html(r);
    expect(out).toContain("$flow.dispatch('ping')");
    expect(out).not.toContain("data-args=");
  });
});

describe("unreachable identifiers are a build error", () => {
  it("rejects a captured variable in a non-call client expression", () => {
    expect(() =>
      compile(
        `<div>{this.rows.map((row) => <button onClick={() => (window.location.href = row.url)}>go</button>)}</div>`,
        "@locked rows = [];",
      ),
    ).toThrow(/references `row`/);
  });

  it("names the file and offers data-args in the message", () => {
    let message = "";
    try {
      compile(
        `<div>{this.rows.map((row) => <button onClick={() => (document.title = row.name)}>t</button>)}</div>`,
        "@locked rows = [];",
      );
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain("demo.tsx");
    expect(message).toContain("data-args");
  });

  it("allows browser globals and Alpine magics", () => {
    const r = compile(
      `<button onClick={() => window.scrollTo(0, Math.max(0, 10))}>top</button>`,
      "@expose x = 1;",
    );
    expect(r).not.toBeNull();

    const withEvent = compile(
      `<input onInput={(e) => (this.q = e.target.value)} />`,
      "@expose q = '';",
    );
    expect(withEvent).not.toBeNull();
  });

  it("allows a name the arrow itself binds", () => {
    const r = compile(
      `<button onClick={() => [1, 2].forEach((n) => console.log(n))}>go</button>`,
      "@expose x = 1;",
    );
    expect(r).not.toBeNull();
  });
});
