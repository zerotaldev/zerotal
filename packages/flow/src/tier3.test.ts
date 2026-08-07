import { describe, it, expect } from "bun:test";
import { jsx } from "./jsx-runtime.ts";
import { transformFlowFile } from "./compiler/transform.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

// ── Runtime prop emission (Tier 3 UI plugin directives) ────────────────────────

describe("Tier 3 props — runtime emission", () => {
  it('mask="…" → x-mask', () => {
    const node = jsx("input", { mask: "(999) 999-9999" }) as HtmlNode;
    expect(node.html).toContain('x-mask="(999) 999-9999"');
  });

  it("collapse (boolean) → x-collapse", () => {
    const node = jsx("div", { collapse: true, children: "x" }) as HtmlNode;
    expect(node.html).toContain("x-collapse");
    expect(node.html).not.toContain('collapse="'); // boolean attr, no value
  });

  it('trap="$flow.open" → x-trap', () => {
    const node = jsx("div", { trap: "$flow.open", children: "x" }) as HtmlNode;
    expect(node.html).toContain('x-trap="$flow.open"');
  });

  it('anchor="$refs.btn" → x-anchor', () => {
    const node = jsx("div", { anchor: "$refs.btn", children: "x" }) as HtmlNode;
    expect(node.html).toContain('x-anchor="$refs.btn"');
  });
});

// ── Compiler prop emission ─────────────────────────────────────────────────────

function page(body: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
export class DemoPage extends Component {
  override async render() { return (${body}); }
}`;
}
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("Tier 3 props — compiler emission", () => {
  it("mask + collapse compile to x-mask / x-collapse", () => {
    const r = transformFlowFile(page(`<input mask="999-99" />`), "/app/flow/pages/demo.tsx");
    expect(html(r)).toContain('x-mask="999-99"');
  });

  it("collapse boolean compiles to x-collapse", () => {
    const r = transformFlowFile(page(`<div collapse>x</div>`), "/app/flow/pages/demo.tsx");
    expect(html(r)).toContain("x-collapse");
  });
});
