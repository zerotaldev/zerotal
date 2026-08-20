// `client(script)` made the caller build the expression, so it owned the escaping — and the
// docblock's `@security Never interpolate unescaped user input` was the whole safety story.
// A search term containing a quote produced a syntax error at best.
//
// `$` is a tagged template, so each interpolation is encoded as a JS literal by the framework.
// The scripts are evaluated with `Alpine.evaluate(rootEl, script)`, which means every value has
// to arrive as source text — these assertions are about that text.
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

class Demo extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

/** The one script queued by `fn`. */
function scriptFrom(fn: (c: Demo) => void): string {
  const c = new Demo();
  fn(c);
  expect(c._clientScripts).toHaveLength(1);
  return c._clientScripts[0]!;
}

describe("the $ tagged template", () => {
  it("queues a plain expression unchanged", () => {
    expect(scriptFrom((c) => c.$`$refs.title.focus()`)).toBe("$refs.title.focus()");
  });

  it("encodes a string as a quoted literal", () => {
    expect(scriptFrom((c) => c.$`console.log(${"iphone"})`)).toBe('console.log("iphone")');
  });

  it("escapes a quote that would otherwise break the expression", () => {
    // The case that made `client()` dangerous.
    expect(scriptFrom((c) => c.$`console.log(${'say "hi"'})`)).toBe('console.log("say \\"hi\\"")');
  });

  it("escapes a backslash", () => {
    expect(scriptFrom((c) => c.$`log(${"a\\b"})`)).toBe('log("a\\\\b")');
  });

  it("keeps numbers and booleans as literals", () => {
    expect(scriptFrom((c) => c.$`n(${42}, ${true}, ${null})`)).toBe("n(42, true, null)");
  });

  it("emits undefined for undefined and for a function", () => {
    expect(scriptFrom((c) => c.$`f(${undefined}, ${() => 1})`)).toBe("f(undefined, undefined)");
  });

  it("keeps non-finite numbers rather than turning them into null", () => {
    // JSON.stringify(NaN) is "null", which would be a silently wrong value.
    expect(scriptFrom((c) => c.$`n(${NaN}, ${Infinity})`)).toBe("n(NaN, Infinity)");
  });

  it("emits a BigInt literal rather than throwing", () => {
    // JSON.stringify throws on BigInt.
    expect(scriptFrom((c) => c.$`n(${10n})`)).toBe("n(10n)");
  });

  it("escapes the line separators that are legal in JSON but not in older JS", () => {
    expect(scriptFrom((c) => c.$`log(${"a b"})`)).toBe('log("a\\u2028b")');
  });

  it("serialises objects and arrays", () => {
    expect(scriptFrom((c) => c.$`set(${{ a: 1, b: [2, 3] }})`)).toBe('set({"a":1,"b":[2,3]})');
  });

  it("interpolates several values in order", () => {
    expect(scriptFrom((c) => c.$`a(${1})b(${2})c`)).toBe("a(1)b(2)c");
  });

  it("batches in call order, like client()", () => {
    const c = new Demo();
    c.$`first()`;
    c.client("second()");
    c.$`third(${3})`;
    expect(c._clientScripts).toEqual(["first()", "second()", "third(3)"]);
  });
});
