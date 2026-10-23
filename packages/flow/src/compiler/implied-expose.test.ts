import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

/**
 * Some field decorators expose a property without `@expose` written beside them: `@url`,
 * `@reactive`, `@modelable`, `@presence` and `@shared` (decorators.ts registers each as exposed,
 * and the last two as locked as well). The compiler decides what a page may read from its
 * decorators, so it has to know that too. Without it a page reading `{this.token}` from a
 * `@url token` field failed to compile with
 * `"token" does not match any @expose, @locked, or @computed property`: skipped with a warning
 * outside `cspSafe`, and a stopped build under it.
 */
function page(member: string, body = "<p>{this.q}</p>"): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, url } from '@zerotal/flow';
export class DemoPage extends Component {
  ${member}
  override async render() { return (${body}); }
}`;
}

const FILE = "/app/flow/pages/demo.tsx";
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");
const NOT_READABLE = "does not match any @expose, @locked, or @computed property";

describe("Flow compiler - fields exposed by another decorator are readable", () => {
  it.each([
    ["bare @url", `@url q = "";`],
    ["configured @url", `@url({ as: "search", history: "push" }) q = "";`],
    ["@reactive", `@reactive q = 0;`],
    ["@modelable", `@modelable q = "";`],
    ["@presence", `@presence("room") q = "";`],
    ["@shared", `@shared("room") q = "";`],
  ])("reads a %s field", (_label, member) => {
    const r = transformFlowFile(page(member), FILE);
    expect(r).not.toBeNull();
    expect(html(r)).toContain("this.q");
  });

  it.each([
    ["no decorator at all", `q = "";`],
    ["@session, which persists a field and exposes nothing", `@session q = "";`],
    ["some other call decorator", `@other({ as: "q" }) q = "";`],
  ])("still rejects a field with %s", (_label, member) => {
    expect(() => transformFlowFile(page(member), FILE)).toThrow(NOT_READABLE);
  });

  it("treats @presence and @shared as locked, like the runtime: a bound input is read-only", () => {
    for (const member of [`@presence("room") q = "";`, `@shared("room") q = "";`]) {
      const out = html(transformFlowFile(page(member, "<input value={this.q} />"), FILE));
      expect(out).toContain(':value="$flow.q"');
      expect(out).toContain("readonly");
    }
  });

  it("treats @url, @reactive and @modelable as writable, not locked: a bound input is a model", () => {
    for (const member of [`@url q = "";`, `@reactive q = "";`, `@modelable q = "";`]) {
      const out = html(transformFlowFile(page(member, "<input value={this.q} />"), FILE));
      expect(out).toContain('flow:model="q"');
      expect(out).not.toContain("readonly");
    }
  });
});
