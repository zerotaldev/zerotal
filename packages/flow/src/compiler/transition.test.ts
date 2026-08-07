import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

function page(body: string, members = "@expose open = false;"): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}
const html = (b: string, m?: string) => {
  const r = transformFlowFile(page(b, m), "/app/flow/pages/demo.tsx");
  return r ? r.renderBody.replace(/\\/g, "") : "";
};

describe("Flow compiler — transition on show= (Alpine x-transition)", () => {
  it("show={this.prop} WITHOUT transition stays on the bridge's flow:show", () => {
    const out = html(`<div show={this.open}>x</div>`);
    expect(out).toContain(`flow:show="open"`);
    expect(out).not.toContain("x-show");
    expect(out).not.toContain("x-transition");
  });

  it("show={this.prop} transition → Alpine x-show + x-transition (no flow:show / no custom animator)", () => {
    const out = html(`<div show={this.open} transition>x</div>`);
    expect(out).toContain(`x-show="$flow.open"`);
    expect(out).toContain(`x-transition:enter="flow-t-fade"`); // bare → fade default
    expect(out).toContain(`x-transition:enter-start="flow-t-out"`);
    expect(out).toContain(`x-transition:leave-end="flow-t-out"`);
    expect(out).not.toContain("flow:show");
    expect(out).not.toContain("flow:transition"); // NOT the morph-enter attr
  });

  it('transition="slide-right" carries the preset into the x-transition classes', () => {
    const out = html(`<aside show={this.open} transition="slide-right">x</aside>`);
    expect(out).toContain(`x-show="$flow.open"`);
    expect(out).toContain(`x-transition:enter="flow-t-slide-right"`);
    expect(out).toContain(`x-transition:leave="flow-t-slide-right"`);
  });

  it("store-driven show + transition uses the SAME Alpine x-transition emission", () => {
    const out = html(`<div show={$flow.store.ui.open} transition="slide-left">x</div>`);
    expect(out).toContain(`x-show="$flow.$store.ui.open"`);
    expect(out).toContain(`x-transition:enter="flow-t-slide-left"`);
    expect(out).toContain(`x-transition:enter-start="flow-t-out"`);
    expect(out).not.toContain("flow:transition");
  });

  it("bare `transition` WITHOUT show= is still the morph-enter flow:transition", () => {
    const out = html(`<li transition>x</li>`);
    expect(out).toContain(" flow:transition");
    expect(out).not.toContain("x-transition");
  });
});
