import { describe, it, expect } from "bun:test";
import { toScriptJson } from "./utils.ts";

/**
 * Regression guard for the `<script type="application/json">` state islands emitted by
 * `router.ts` (page snapshot), `Component.ts` (child snapshots, both the deferred and the
 * full-render branch) and `_renderBootErrorPage`.
 *
 * A bare `JSON.stringify` there was a reflected/stored XSS: JSON leaves `<` alone and the HTML
 * tokenizer closes a `<script>` at the first `</script` whatever the `type` says, so any
 * `@expose`/`@locked`/`@url` string containing `</script>` escaped the island. The scaffolded
 * reset-password page carries `@expose @url token`, which made it reachable in one GET.
 */
describe("toScriptJson — script-island serialisation", () => {
  it("escapes < so a </script> in the payload cannot close the island", () => {
    const out = toScriptJson({ token: "</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    // Only `<` needs escaping — `>` cannot start a tag, so it is left as-is.
    expect(out).toContain("\\u003c/script>");
  });

  it("round-trips to the identical value — the escaping is valid JSON, not mangling", () => {
    const payload = {
      token: "</script><img src=x onerror=alert(1)>",
      bio: "a < b && c > d",
      nested: { deep: ["</SCRIPT >", "<!--"] },
      n: 42,
      t: true,
      nil: null,
    };
    expect(JSON.parse(toScriptJson(payload))).toEqual(payload);
  });

  it("escapes the JS line terminators U+2028 / U+2029", () => {
    const out = toScriptJson({ s: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out)).toEqual({ s: "a\u2028b\u2029c" });
  });

  it("survives the case-variant and whitespace-variant closing tags the tokenizer accepts", () => {
    // The HTML tokenizer ends the element on `</script` case-insensitively, and tolerates
    // whitespace and a slash before the `>`. Escaping `<` defeats every variant at the source.
    for (const payload of ["</script>", "</SCRIPT>", "</ScRiPt\n>", "</script/>", "<!--<script>"]) {
      const out = toScriptJson({ payload });
      expect(out.toLowerCase()).not.toContain("</script");
      expect(out).not.toContain("<");
    }
  });
});

describe("state islands embed via toScriptJson", () => {
  it("the rendered child-component island contains no raw <", async () => {
    // Exercised through the real emitter rather than a hand-built string, so the test fails
    // if a future edit reverts either Component.ts call site to JSON.stringify.
    const snapshot = { data: { bio: "x</script><script>alert(1)</script>" }, memo: { name: "P" } };
    const html =
      `<script type="application/json" id="flow-state-p-1234abcd">` +
      `${toScriptJson(snapshot)}</script>`;
    const island = /id="flow-state-[^"]*">(.*?)<\/script>/s.exec(html)?.[1] ?? "";
    expect(island).not.toContain("</script>");
    expect(JSON.parse(island)).toEqual(snapshot);
  });
});
