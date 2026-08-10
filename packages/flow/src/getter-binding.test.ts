/**
 * Getters in a template must never quietly cost an element its binding.
 *
 * From a field report (B39): a `<select>` whose options came from a private
 * getter was said to lose its `flow:model` entirely, and — worse — to hand the
 * dropped model name to the *next* `<select>` in the document, wiring two
 * controls to one field. Silent in dev and in build, and invisible to a test
 * suite that drives actions directly rather than submitting the form.
 *
 * None of it reproduces on this tree; these tests are the proof, one per route
 * the failure could take. They are written as characterisation tests rather than
 * a fix, so that if any route regresses it fails here with the symptom named.
 *
 * The one thing that genuinely cannot work — binding an element's value to a
 * getter — is a hard compile error rather than a dropped attribute, which is what
 * the report asked for as its fallback fix.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";
import { jsx } from "./jsx-runtime.ts";
import { FlowTest } from "./testing.ts";
import { transformFlowFile } from "./compiler/transform.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

// ── The compiled path ────────────────────────────────────────────────────────

function compile(body: string, members: string) {
  const report: { blocker?: unknown } = {};
  const source = `/** @jsxImportSource @zerotal/flow */
import { Component, expose, locked } from '@zerotal/flow';
export class DemoPage extends Component {
  @locked title = "";
  ${members}
  override async render() { return (${body}); }
}`;
  const out = transformFlowFile(source, "/app/flow/pages/demo.tsx", { report });
  return { html: out ? out.renderBody.split(String.fromCharCode(92)).join("") : null, report };
}

const MEMBERS = `@expose filterProvince = ""; @expose filterTown = "";
  private get townOptions() { return ["Durban"]; }`;

describe("compiled: a getter supplying an element's children", () => {
  it("leaves the element's own binding intact", () => {
    const { html } = compile(
      `<select value={this.filterTown} live>{this.townOptions.map((t) => <option>{t}</option>)}</select>`,
      MEMBERS,
    );
    expect(html).toContain('flow:model.live="filterTown"');
  });

  it("does not move the model name onto the next element", () => {
    // The report's worst symptom: two controls bound to one field. Each select
    // must carry its own name and only its own.
    const { html } = compile(
      `<div>` +
        `<select id="t" value={this.filterTown} live>{this.townOptions.map((t) => <option>{t}</option>)}</select>` +
        `<select id="after" value={this.filterProvince} live></select>` +
        `</div>`,
      MEMBERS,
    );
    expect(html).toContain('<select id="t" flow:model.live="filterTown"');
    expect(html).toContain('<select id="after" flow:model.live="filterProvince"');
  });
});

describe("compiled: binding a value straight to a getter", () => {
  it("is a compile error that names the member, not a dropped attribute", () => {
    // A getter is in neither the exposed nor the locked set, so there is nothing
    // to bind to. Saying so is the whole fix: the failure the report describes is
    // expensive precisely because nothing was said.
    expect(() => compile(`<select value={this.townOptions} live></select>`, MEMBERS)).toThrow(
      /townOptions.*does not match any @expose or @locked property/s,
    );
  });
});

describe("compiled: a construct the transform cannot handle", () => {
  it("falls back whole-page rather than emitting a half-built element", () => {
    // `value={t}` over a loop variable is not static, so the page bails to the
    // runtime. It must bail entirely — a partial emit is how a stray attribute
    // would end up on a later element.
    const { html, report } = compile(
      `<select value={this.filterTown} live>{this.townOptions.map((t) => <option value={t}>{t}</option>)}</select>`,
      MEMBERS,
    );
    expect(html).toBeNull();
    expect(report.blocker).toBeDefined();
  });
});

// ── The runtime path ─────────────────────────────────────────────────────────
//
// Where a bailed page actually renders, and where bindings resolve by value
// identity rather than by name — so it is the likelier home for the reported
// symptom than the compiler is.

/** Two exposed props holding the same value: the default for a pair of unset filters. */
class SameValueSelects extends Component {
  @expose filterProvince = "";
  @expose filterTown = "";
  private get townOptions() {
    return ["Durban"];
  }

  override async render() {
    return jsx("div", {
      children: [
        jsx("select", { id: "p", value: this.filterProvince, live: true }),
        jsx("select", {
          id: "t",
          value: this.filterTown,
          live: true,
          children: this.townOptions.map((t) => jsx("option", { children: t })),
        }),
      ],
    });
  }
}

describe("runtime: value-identity binding with a getter in between", () => {
  it("binds each select to its own prop even when both hold the same value", async () => {
    // Value identity alone cannot separate two props that are both "", so this is
    // the case that would fail if the getter read clobbered the capture slot.
    const html = (await FlowTest.mount(SameValueSelects)).html();

    expect(html).toContain('flow:model.live="filterProvince"');
    expect(html).toContain('flow:model.live="filterTown"');
    // Neither name appears twice — one field, one control.
    expect(html.match(/flow:model\.live="filterTown"/g)).toHaveLength(1);
    expect(html.match(/flow:model\.live="filterProvince"/g)).toHaveLength(1);
  });
});
