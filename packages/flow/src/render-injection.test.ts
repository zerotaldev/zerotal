/**
 * Injection controls in the render path.
 *
 * Flow renders into raw HTML strings and then splices child components into that string,
 * so "what can a user-controlled value do to the surrounding markup?" has to be answered
 * per character class rather than assumed. Each case here failed before the fix.
 */
import { describe, it, expect } from "bun:test";
import { jsx } from "./jsx-runtime.ts";
import { isSafeUrl, sanitizeUrl, BLOCKED_URL } from "./urlSafety.ts";
import { jsLiteral } from "./utils.ts";

const render = (node: { html: string }) => node.html;

describe("attribute escaping", () => {
  it("escapes < and > so a value cannot carry the child-placeholder comment", () => {
    // The child splice is a blind split/join over finished HTML, so a value that contains
    // the placeholder gets replaced by child markup — whose quotes then close the attribute.
    const html = render(jsx("div", { title: "<!--flow-child:abc:0-->", children: "x" }));
    expect(html).not.toContain("<!--");
    expect(html).toContain("&lt;!--flow-child");
  });

  it("escapes a quote so an attribute cannot be terminated early", () => {
    const html = render(jsx("div", { title: '" onmouseover="alert(1)', children: "x" }));
    expect(html).toContain("&quot;");
    expect(html).not.toContain('title="" onmouseover=');
  });

  it("escapes & so entity decoding cannot reconstitute either", () => {
    const html = render(jsx("div", { title: "&lt;script&gt;", children: "x" }));
    expect(html).toContain("&amp;lt;");
  });
});

describe("URL-bearing attributes", () => {
  it("classifies schemes the browser executes", () => {
    for (const safe of [
      "/x",
      "https://a.test",
      "#f",
      "?q=1",
      "mailto:a@b.c",
      "data:image/png;base64,x",
    ]) {
      expect(isSafeUrl(safe)).toBe(true);
    }
    for (const unsafe of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "vbscript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml,<svg onload=alert(1)>",
    ]) {
      expect(isSafeUrl(unsafe)).toBe(false);
    }
  });

  it("neutralises a javascript: href rather than rendering it", () => {
    const html = render(jsx("a", { href: "javascript:alert(1)", children: "Website" }));
    expect(html).toContain(`href="${BLOCKED_URL}"`);
    expect(html).not.toContain("javascript:");
  });

  it("covers the less obvious URL attributes too", () => {
    for (const attr of ["src", "formaction", "action", "poster", "xlink:href"]) {
      const html = render(jsx("x", { [attr]: "javascript:alert(1)", children: "" }));
      expect(html).toContain(BLOCKED_URL);
    }
  });

  it("leaves ordinary URLs alone", () => {
    expect(sanitizeUrl("/dashboard")).toBe("/dashboard");
    expect(render(jsx("a", { href: "/dashboard", children: "Go" }))).toContain('href="/dashboard"');
  });
});

describe("Alpine expressions", () => {
  it("jsLiteral produces an operand, not a boundary a value can cross", () => {
    expect(jsLiteral("a")).toBe('"a"');
    expect(jsLiteral("'); alert(1); ('")).toBe("\"'); alert(1); ('\"");
    expect(jsLiteral('he said "hi"')).toBe('"he said \\"hi\\""');
    // A literal line terminator would end the expression statement.
    expect(jsLiteral("a\nb")).toBe('"a\\nb"');
  });
});
