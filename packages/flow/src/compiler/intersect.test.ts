import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

function page(body: string, members = "@expose load() {}"): string {
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

describe("Flow compiler — intersect modifiers (x-intersect parity)", () => {
  it("onIntersect + intersectOnce → flow:intersect + flow:intersect.once", () => {
    const out = html(`<div onIntersect={this.load} intersectOnce>x</div>`);
    expect(out).toContain(`flow:intersect="load"`);
    expect(out).toContain(" flow:intersect.once");
  });

  it("intersectThreshold + intersectMargin carry through as string directives", () => {
    const out = html(
      `<div onIntersect={this.load} intersectThreshold="full" intersectMargin="200px">x</div>`,
    );
    expect(out).toContain(`flow:intersect.threshold="full"`);
    expect(out).toContain(`flow:intersect.margin="200px"`);
  });
});
