import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

function page(body: string, members: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}
const html = (b: string, m: string) => {
  const r = transformFlowFile(page(b, m), "/app/flow/pages/demo.tsx");
  return r ? r.renderBody.replace(/\\/g, "") : "";
};

describe("Flow compiler — x-model modifiers (number/trim)", () => {
  it("`number` emits data-flow-number on the model binding", () => {
    const out = html(`<input value={this.age} number />`, "@expose age = 0;");
    expect(out).toContain(`flow:model="age"`);
    expect(out).toContain("data-flow-number");
  });

  it("`trim` emits data-flow-trim", () => {
    const out = html(`<input value={this.name} trim />`, '@expose name = "";');
    expect(out).toContain("data-flow-trim");
  });

  it("combines with live and with each other, and never leaks as raw attrs", () => {
    const out = html(`<input value={this.age} number trim live />`, "@expose age = 0;");
    expect(out).toContain(`flow:model.live="age"`);
    expect(out).toContain("data-flow-number");
    expect(out).toContain("data-flow-trim");
    expect(out).not.toMatch(/[^-]\bnumber\b/); // no bare `number` attribute
    expect(out).not.toMatch(/\btrim="?/);
  });
});

describe("Flow compiler — focus management (autoFocus/focusOnError)", () => {
  it("`autoFocus` → flow:autofocus", () => {
    expect(html(`<input value={this.email} autoFocus />`, '@expose email = "";')).toContain(
      "flow:autofocus",
    );
  });

  it("`focusOnError` → flow:focus-error", () => {
    expect(html(`<input value={this.email} focusOnError />`, '@expose email = "";')).toContain(
      "flow:focus-error",
    );
  });
});

describe("Flow compiler — persisted drafts (draft=)", () => {
  it('`draft="key"` → flow:draft on the input', () => {
    const out = html(`<textarea value={this.body} draft="post-body" />`, '@expose body = "";');
    expect(out).toContain(`flow:model="body"`);
    expect(out).toContain(`flow:draft="post-body"`);
  });
});
