import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

/** Wrap a render() return-body in a minimal Component page with the given members. */
function page(body: string, members = "@expose count = 0;"): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}

function compile(body: string, members?: string) {
  return transformFlowFile(page(body, members), "/app/flow/pages/demo.tsx");
}

/** renderBody is JS source, so emitted HTML has JSON-escaped quotes; strip backslashes to assert. */
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("Flow compiler — $flow client magics (bare authoring → $-prefixed runtime)", () => {
  it("AOT-rewrites a bare $flow.store read to $flow.$store, via Alpine-native x-text", () => {
    const r = compile(`<span>{$flow.store.ui.dark ? 'On' : 'Off'}</span>`);
    expect(r).not.toBeNull();
    // Author wrote bare $flow.store; compiler emits $flow.$store, in an x-text (not flow:text).
    expect(html(r)).toContain(`x-text="$flow.$store.ui.dark ? 'On' : 'Off'"`);
    expect(html(r)).not.toContain("flow:text");
  });

  it("emits a reactive :class binding for a store-driven class ($flow.store → $flow.$store)", () => {
    const r = compile(`<div class={$flow.store.ui.dark ? 'dark' : 'light'} />`);
    expect(html(r)).toContain(`:class="$flow.$store.ui.dark ? 'dark' : 'light'"`);
  });

  it("emits Alpine-native x-show for show={$flow.store.x} (not flow:show)", () => {
    const r = compile(`<aside show={$flow.store.ui.sidebar}>menu</aside>`);
    expect(html(r)).toContain(`x-show="$flow.$store.ui.sidebar"`);
    expect(html(r)).not.toContain("flow:show");
  });

  it("keeps show={this.prop} on the server-owned flow:show path", () => {
    const r = compile(`<div show={this.open}>x</div>`, "@expose open = false;");
    expect(html(r)).toContain(`flow:show="open"`);
    expect(html(r)).not.toContain("x-show");
  });

  it("AOT-rewrites a bare $flow.store write in an onClick handler", () => {
    const r = compile(
      `<button onClick={() => ($flow.store.ui.dark = !$flow.store.ui.dark)}>Toggle</button>`,
    );
    expect(html(r)).toContain("flow:click=");
    expect(html(r)).toContain("$flow.$store.ui.dark = !$flow.$store.ui.dark");
  });

  it("rewrites bare $flow magics in a handler ($flow.set/$flow.toggle → $-form)", () => {
    const r = compile(`<button onClick={() => $flow.toggle('open')}>x</button>`);
    expect(html(r)).toContain("$flow.$toggle('open')");
  });

  it("mixes this.<prop> (→$flow.prop) and $flow magic (→$flow.$…) correctly", () => {
    const r = compile(`<span>{this.count + $flow.store.cart.count}</span>`);
    expect(html(r)).toContain(`x-text="$flow.count + $flow.$store.cart.count"`);
  });

  it("rejects a $flow value selecting between JSX subtrees with a clear error", () => {
    expect(() => compile(`<div>{$flow.store.ui.dark ? <b>a</b> : <i>b</i>}</div>`)).toThrow(/JSX/);
  });

  it("frees the bare names on the class: this.set is the dev's member, never the magic", () => {
    // `set` is no longer reserved, so this must reach the developer's own @expose `set`
    // action rather than the $set magic. A one-call arrow with arguments now compiles to
    // a named action plus data-args (rather than an inline `$flow.set('a', 1)` that the
    // proxy would have to route), which reaches the same action without an eval.
    const r = compile(
      `<button onClick={() => this.set('a', 1)}>x</button>`,
      "@expose set(k, v) {}",
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain(`flow:click="set"`);
    expect(html(r)).toContain("JSON.stringify(['a', 1])");
    expect(html(r)).not.toContain("$flow.$set"); // the dev member must NOT become the magic
  });

  it("errors when a bare this.<magic-name> is used without the dev defining it", () => {
    expect(() => compile(`<button onClick={() => this.toggle('open')}>x</button>`)).toThrow();
  });

  it("compiles text={$flow.store…} to Alpine-native x-text (flow:text can't read the store)", () => {
    const r = compile(`<button text={$flow.store.ui.dark ? 'Light' : 'Dark'}>Toggle</button>`);
    expect(r).not.toBeNull();
    expect(html(r)).toContain(`x-text="$flow.$store.ui.dark ? 'Light' : 'Dark'"`);
    expect(html(r)).not.toContain("flow:text");
    // The literal children stay as the server-rendered fallback until Alpine swaps them.
    expect(html(r)).toContain(">Toggle<");
  });

  it("fails fast when a page reads $flow in a binding but can't be AOT-compiled", () => {
    // An imported component forces the runtime renderer, which would evaluate `$flow` on the
    // server ("$flow is not defined"). The compiler must raise a clear error instead.
    const src = `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
import { Header } from './header.tsx';
export class P extends Component {
  override async render() { return (<div><Header /><span class={$flow.store.ui.dark ? "a" : "b"} /></div>); }
}`;
    expect(() => transformFlowFile(src, "/app/p.tsx")).toThrow(/can't be statically compiled/);
  });

  it("does NOT fail when a bailing page uses $flow only in a handler (never server-evaluated)", () => {
    const src = `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
import { Header } from './header.tsx';
export class P extends Component {
  override async render() { return (<div><Header /><button onClick={() => ($flow.store.ui.dark = true)}>x</button></div>); }
}`;
    expect(() => transformFlowFile(src, "/app/p.tsx")).not.toThrow();
  });

  it("does not rewrite a this.<prop> whose name happens to match a magic", () => {
    // A prop literally named `store`: this.store → $flow.store (reactive read), never $flow.$store.
    const r = compile(`<span>{this.count}</span>`, "@expose count = 0; @expose store = 0;");
    expect(html(r)).toContain("__esc(this.count)");
  });
});
