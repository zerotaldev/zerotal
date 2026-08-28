/**
 * The plain-form enhancement's decisions, and the one property of its bundle that
 * cannot be allowed to regress.
 *
 * The browser tests beside these ([enhance.browser.test.ts](../browser/enhance.browser.test.ts))
 * prove the feature works. These cover the parts that are cheap to get wrong and
 * expensive to notice.
 */
import { describe, it, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { ATTR, matchIn, sameUrl, targetFor } from "./enhanceSupport.ts";

/** A minimal element stand-in: this file runs without a DOM. */
function el(attrs: Record<string, string> = {}): HTMLFormElement {
  return {
    id: attrs["id"] ?? "",
    getAttribute: (n: string) => attrs[n] ?? null,
  } as unknown as HTMLFormElement;
}

describe("the bundle is a classic script", () => {
  /**
   * `/__flow/enhance.js` is loaded by `<script src>` with no `type="module"`, on
   * pages that have no module loader. A trailing `export` is a SyntaxError there,
   * and the browser discards the **entire file** — silently, because the forms then
   * post natively and the page still works. The enhancement is absent on exactly
   * the pages it was added for, with nothing in the console to say so.
   *
   * This is not hypothetical: it is how the feature was first written, and the only
   * symptom was a browser test noticing a render counter had moved.
   */
  it("compiles to a bundle with no export statement", async () => {
    const entry = fileURLToPath(new URL("./enhance.ts", import.meta.url));
    const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm" });
    expect(result.success).toBe(true);

    const code = await result.outputs[0]!.text();
    expect(code).not.toMatch(/^export[\s{]/m);
    expect(code).not.toMatch(/^import[\s{]/m);
    // It installs itself: nothing on the page calls into it.
    expect(code).toContain("addEventListener");
  });

  it("does not drag the runtime in behind it", async () => {
    const entry = fileURLToPath(new URL("./enhance.ts", import.meta.url));
    const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm" });
    const code = await result.outputs[0]!.text();
    // A page with no Flow component pays for a submit handler, not for Alpine and
    // a WebSocket bridge. If this ever fails, an import crept into the entry.
    expect(code).not.toContain("alpine");
    expect(code).not.toContain("new WebSocket");
    expect(code.length).toBeLessThan(20_000);
  });
});

describe("sameUrl", () => {
  const base = "http://app.test/plain/form";

  it("resolves both sides, so a relative action is not read as a redirect", () => {
    // The failure this prevents: `action="/subscribe"` compared raw against the
    // absolute `response.url` would call every ordinary submission a redirect and
    // replace the whole document each time.
    expect(sameUrl("http://app.test/subscribe", "/subscribe", base)).toBe(true);
  });

  it("sees a genuinely different destination", () => {
    expect(sameUrl("http://app.test/landed", "/subscribe", base)).toBe(false);
  });

  it("treats an empty side as not matching", () => {
    expect(sameUrl("", "/subscribe", base)).toBe(false);
    expect(sameUrl("/subscribe", "", base)).toBe(false);
  });

  it("falls back to a literal comparison on an unparseable URL", () => {
    expect(sameUrl("::nonsense", "::nonsense", "::also-nonsense")).toBe(true);
  });
});

describe("targetFor", () => {
  const noop = (): void => {};

  it("defaults to the form, so errors land where the person is looking", () => {
    const form = el({ id: "subscribe" });
    const root = { querySelector: () => null } as unknown as ParentNode;
    expect(targetFor(form, root, noop)).toBe(form);
  });

  it("honours an explicit target", () => {
    const panel = { id: "panel" } as unknown as Element;
    const form = el({ "data-enhance-target": "#panel" });
    const root = { querySelector: () => panel } as unknown as ParentNode;
    expect(targetFor(form, root, noop)).toBe(panel);
  });

  it("reports a target that matches nothing, and replaces the form instead", () => {
    const form = el({ "data-enhance-target": "#gone" });
    const root = { querySelector: () => null } as unknown as ParentNode;
    const missing: string[] = [];
    expect(targetFor(form, root, (s) => missing.push(s))).toBe(form);
    // Harmless and visible: the page still works and the console says why.
    expect(missing).toEqual(["#gone"]);
  });
});

describe("matchIn", () => {
  it("prefers an id, which survives a re-order", () => {
    const found = { id: "subscribe" } as unknown as Element;
    const doc = { getElementById: () => found } as unknown as Document;
    const form = el({ id: "subscribe" });
    expect(matchIn(doc, {} as ParentNode, form, form as unknown as Element)).toBe(found);
  });

  it("uses the author's selector when there is no id", () => {
    const panel = {} as Element;
    const doc = {
      getElementById: () => null,
      querySelector: (s: string) => (s === "#panel" ? panel : null),
    } as unknown as Document;
    const form = el({ "data-enhance-target": "#panel" });
    expect(matchIn(doc, {} as ParentNode, form, {} as Element)).toBe(panel);
  });

  it("falls back to position, so a bare form needs no attributes at all", () => {
    const first = {} as Element;
    const second = {} as Element;
    const form = el();
    const live = { querySelectorAll: () => [{}, form] } as unknown as ParentNode;
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [first, second],
    } as unknown as Document;
    // The live form is second among the enhanced forms, so it matches the second
    // one in the response — not the first, which belongs to a different form.
    expect(matchIn(doc, live, form, {} as Element)).toBe(second);
  });

  it("is null when the response has no counterpart, so the caller can navigate", () => {
    const form = el();
    const live = { querySelectorAll: () => [form] } as unknown as ParentNode;
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [],
    } as unknown as Document;
    expect(matchIn(doc, live, form, {} as Element)).toBeNull();
  });
});

describe("the attribute", () => {
  it("is the one the docs and the helper agree on", () => {
    expect(ATTR).toBe("data-enhance");
  });
});
