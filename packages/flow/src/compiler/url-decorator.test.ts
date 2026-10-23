import { describe, it, expect } from "bun:test";
import { transformFlowFile } from "./transform.ts";

/**
 * `@url` implies `@expose`: a field that lives in the address bar is held by the client. The
 * compiler decides what a page may read from its decorators, so it has to know that too.
 * Without it a page reading `{this.token}` from a `@url token` field failed to compile with
 * `"token" does not match any @expose, @locked, or @computed property`.
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

describe("Flow compiler - @url fields are readable", () => {
  it("reads a bare @url field", () => {
    const r = transformFlowFile(page(`@url q = "";`), FILE);
    expect(r).not.toBeNull();
    expect(html(r)).toContain("this.q");
  });

  it("reads a configured @url field", () => {
    const r = transformFlowFile(page(`@url({ as: "search", history: "push" }) q = "";`), FILE);
    expect(r).not.toBeNull();
  });

  it("still rejects a field with no decorator at all", () => {
    expect(() => transformFlowFile(page(`q = "";`), FILE)).toThrow(
      "does not match any @expose, @locked, or @computed property",
    );
  });

  it("does not treat some other call decorator as @url", () => {
    expect(() => transformFlowFile(page(`@other({ as: "q" }) q = "";`), FILE)).toThrow(
      "does not match any @expose, @locked, or @computed property",
    );
  });
});
