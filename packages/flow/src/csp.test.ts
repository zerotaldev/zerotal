import { describe, it, expect } from "bun:test";
import { evaluateCsp, CspSyntaxError } from "./client/cspEvaluator.ts";
import { transformFlowFile } from "./compiler/transform.ts";

function cspPage(body: string, members = "@expose count = 0;"): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}
const cspHtml = (b: string) =>
  (
    transformFlowFile(cspPage(b), "/app/flow/pages/demo.tsx", { cspSafe: true })?.renderBody ?? ""
  ).replace(/\\/g, "");

function scope() {
  return {
    $flow: {
      count: 7,
      name: "al",
      items: [1, 2, 3],
      saved: null as unknown,
      save(a: number, b: number) {
        this.saved = [a, b];
        return a + b;
      },
    } as Record<string, unknown> & { count: number; saved: unknown },
  };
}

describe("CSP evaluator — supported subset", () => {
  it("reads members and evaluates logic/arithmetic/ternary/concat", () => {
    const s = scope();
    expect(evaluateCsp("$flow.count", s)).toBe(7);
    expect(evaluateCsp("$flow.count > 5 && $flow.count < 10", s)).toBe(true);
    expect(evaluateCsp('$flow.count > 5 ? "hi " + $flow.name : "lo"', s)).toBe("hi al");
    expect(evaluateCsp("!$flow.count", s)).toBe(false);
  });

  it("builds array and object literals", () => {
    const s = scope();
    expect(evaluateCsp("[1, $flow.count, 3]", s)).toEqual([1, 7, 3]);
    expect(evaluateCsp("{ a: 1, b: $flow.name }", s)).toEqual({ a: 1, b: "al" });
  });

  it("writes back through the scope (so $flow set-traps still fire)", () => {
    const s = scope();
    expect(evaluateCsp("$flow.count++", s)).toBe(7); // postfix returns old
    expect(s.$flow.count).toBe(8);
    evaluateCsp("$flow.count = 0", s);
    expect(s.$flow.count).toBe(0);
    evaluateCsp("$flow.count += 5", s);
    expect(s.$flow.count).toBe(5);
  });

  it("calls methods with arguments and correct this-binding", () => {
    const s = scope();
    expect(evaluateCsp("$flow.save(2, 3)", s)).toBe(5);
    expect(s.$flow.saved).toEqual([2, 3]);
  });
});

describe("CSP evaluator — rejects unsupported syntax", () => {
  const s = scope();
  it("throws on arrow functions", () => {
    expect(() => evaluateCsp("() => $flow.count", s)).toThrow(CspSyntaxError);
  });
  it("throws on template literals", () => {
    expect(() => evaluateCsp("`hi ${x}`", s)).toThrow(CspSyntaxError);
  });
  it("throws on computed member access", () => {
    expect(() => evaluateCsp("$flow.items[0]", s)).toThrow(CspSyntaxError);
  });
  it("throws on spread", () => {
    expect(() => evaluateCsp("{ ...$flow }", s)).toThrow(CspSyntaxError);
  });
});

describe("compiler CSP-safe emission", () => {
  it("server actions and value bindings are unchanged", () => {
    expect(
      cspHtml(`<button onClick={this.bump}>+</button>`, "@expose count=0; bump(){}"),
    ).toContain('flow:click="bump"');
    expect(cspHtml(`<input value={this.count} />`)).toContain('flow:model="count"');
  });

  it("emits a BARE client expression (no arrow wrapper)", () => {
    const html = cspHtml(`<button onClick={() => this.count++}>+</button>`);
    expect(html).toContain('flow:click="$flow.count++"');
    expect(html).not.toContain("=>");
  });

  it("rejects an arrow that needs the event argument", () => {
    expect(() =>
      transformFlowFile(
        cspPage(`<button onClick={(e) => this.count++}>+</button>`),
        "/app/flow/pages/demo.tsx",
        { cspSafe: true },
      ),
    ).toThrow();
  });

  it("rejects a block-body arrow", () => {
    expect(() =>
      transformFlowFile(
        cspPage(`<button onClick={() => { this.count++ }}>+</button>`),
        "/app/flow/pages/demo.tsx",
        { cspSafe: true },
      ),
    ).toThrow();
  });

  it("default (non-CSP) mode still emits the arrow form", () => {
    const r = transformFlowFile(
      cspPage(`<button onClick={() => this.count++}>+</button>`),
      "/app/flow/pages/demo.tsx",
    );
    expect((r?.renderBody ?? "").replace(/\\/g, "")).toContain("() => $flow.count++");
  });
});
