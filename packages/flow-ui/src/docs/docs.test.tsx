/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { SPECS, findSpec } from "./spec.tsx";
import { renderComponentSection, renderCombinedDoc, renderAllDocs } from "./render.ts";
import { COMPONENTS, findComponent } from "../registry.ts";

describe("doc specs", () => {
  it("has a spec for every registry component", () => {
    for (const c of COMPONENTS) {
      expect(findSpec(c.name), `missing spec for ${c.name}`).toBeDefined();
    }
    expect(SPECS.length).toBe(COMPONENTS.length);
  });

  it("every preview renders to non-empty HTML", () => {
    for (const s of SPECS) {
      expect(s.preview.html.length, `empty preview for ${s.name}`).toBeGreaterThan(0);
      expect(s.preview.html).toStartWith("<");
    }
  });

  it("every spec has a code snippet and at least one prop", () => {
    for (const s of SPECS) {
      expect(s.code.length).toBeGreaterThan(0);
      expect(s.props.length).toBeGreaterThan(0);
    }
  });
});

describe("renderComponentSection", () => {
  const entry = findComponent("button")!;
  const md = renderComponentSection(entry, findSpec("button")!);

  it("is an h2 section with a stable anchor and unique h3 sub-headings", () => {
    expect(md).toContain('<a id="components-button"></a>');
    expect(md).toContain("## Button");
    expect(md).toContain("### Button installation");
    expect(md).toContain("bun zt flow:add button");
    expect(md).toContain("### Button preview");
    expect(md).toContain('<div class="not-prose');
    expect(md).toContain("### Button usage");
    expect(md).toContain("```tsx");
    expect(md).toContain("### Button props");
  });

  it("renders props as a raw HTML table so union-type pipes render cleanly", () => {
    // Raw HTML table (not a markdown table) — so a `|` in a TS union renders as `|`,
    // not an escaped `\|`, and never splits a row.
    expect(md).toContain("<table>");
    expect(md).toContain("<th>Prop</th>");
    expect(md).toContain("<code>variant</code>");
    // The union type keeps its literal pipe, no backslash escaping.
    expect(md).toContain(`"default" | "secondary"`);
    expect(md).not.toContain("\\|");
  });
});

describe("renderCombinedDoc", () => {
  const md = renderCombinedDoc();

  it("has one title, an overview list, and a section per component", () => {
    expect(md.match(/^# /gm)?.length).toBe(1);
    expect(md).toContain("# Components");
    for (const c of COMPONENTS) {
      // overview list links to the in-page anchor…
      expect(md).toContain(`[${c.title}](#components-${c.name})`);
      // …and the section anchor exists
      expect(md).toContain(`<a id="components-${c.name}"></a>`);
    }
  });

  it("uses no horizontal-rule separators", () => {
    expect(md).not.toMatch(/^---+$/m);
  });

  it("has unique h2/h3 headings so ToC anchors don't collide", () => {
    const headings = [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]);
    expect(new Set(headings).size).toBe(headings.length);
  });
});

describe("renderAllDocs", () => {
  it("produces a single combined components page", () => {
    const all = renderAllDocs();
    expect(Object.keys(all)).toEqual(["components"]);
    expect(all["components"]).toContain("# Components");
  });
});
