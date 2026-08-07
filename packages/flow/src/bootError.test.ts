import { describe, it, expect } from "bun:test";
import { _renderBootErrorPage } from "./router.ts";

describe("initial-render error page (dev)", () => {
  it("embeds the error detail as a JSON boot-error script the bridge can read", () => {
    const html = _renderBootErrorPage(new TypeError("kaboom"), "DashboardPage");
    expect(html).toContain('id="flow-boot-error"');
    // The embedded JSON carries the overlay fields.
    const json = /id="flow-boot-error">(.*?)<\/script>/s.exec(html)?.[1] ?? "";
    const parsed = JSON.parse(json.replace(/\\u003c/g, "<"));
    expect(parsed.name).toBe("TypeError");
    expect(parsed.message).toBe("kaboom");
    expect(parsed.action).toBe("initial render");
    expect(parsed.component).toBe("DashboardPage");
    expect(String(parsed.stack)).toContain("kaboom");
  });

  it("neutralises a </script> in the error message (no early script close)", () => {
    const html = _renderBootErrorPage(new Error("evil </script><script>alert(1)</script>"), "P");
    // The raw closing tag must not appear inside the JSON island — it's escaped to \\u003c/script>.
    const island = /id="flow-boot-error">(.*?)<\/script>\s/s.exec(html)?.[1] ?? "";
    expect(island).not.toContain("</script>");
    expect(island).toContain("\\u003c/script>");
  });

  it("is a full HTML document that loads the runtime when available", () => {
    const html = _renderBootErrorPage(new Error("x"), "P");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // No runtime bundle is built in a unit test, so the tag is omitted (no throw).
    expect(html).toContain("<title>Error — P</title>");
  });
});
