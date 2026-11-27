/**
 * What the development error page puts in front of whoever opens it.
 *
 * Development-only, but it is also the page that gets opened from a link, saved,
 * screenshotted into an issue or pasted to a colleague, so what it executes and
 * what it prints both matter.
 */
import { describe, it, expect } from "bun:test";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { renderDevErrorPage, _displayHeaders, _scriptJson } from "./DevErrorPage.ts";

/** Every `<script>`…`</script>` block in a page, as the HTML parser would split them. */
function scriptBlocks(html: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<script>", from);
    if (open === -1) return blocks;
    const close = html.indexOf("</script>", open);
    blocks.push(html.slice(open, close === -1 ? undefined : close));
    from = close === -1 ? html.length : close + 1;
  }
}

describe("the error page's script payloads", () => {
  it("keeps a message that echoes `</script>` inside its script block", async () => {
    // The parser ends a script at the first `</script>`, inside a string or not, so
    // an error that echoes request input could close the block and write markup.
    // Assembled at run time, so the page's quote of this file's source cannot contain it.
    const payload = ["</", "script><img src=x onerror=alert(", Date.now(), ")>"].join("");
    const html = await (await renderDevErrorPage(new Error(`No such user: ${payload}`))).text();

    expect(html).not.toContain(payload);
    expect(html).not.toContain("<img src=x onerror=");
    // One script block, and it still ends where the page ends it.
    const blocks = scriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("function copyForAI");
  });

  it("serialises to the same value the script reads back", () => {
    const value = {
      message: `a </script> & <b> ${String.fromCharCode(0x2028)} b`,
      nested: ["<!--", "-->"],
    };
    const source = _scriptJson(value);
    expect(source).not.toMatch(/[<>&]/);
    expect(JSON.parse(source)).toEqual(value);
  });
});

describe("the request headers the page shows", () => {
  it("masks credentials and leaves the rest readable", () => {
    const shown = _displayHeaders(
      new Headers({
        accept: "text/html",
        authorization: "Bearer sk-live",
        "x-api-key": "key-123",
        "x-csrf-token": "tok",
        cookie: "sid=abc",
      }),
    );
    const byName = Object.fromEntries(shown.map(({ k, v }) => [k, v]));

    expect(byName["accept"]).toBe("text/html");
    expect(byName["authorization"]).toBe("‹redacted›");
    expect(byName["x-api-key"]).toBe("‹redacted›");
    expect(byName["x-csrf-token"]).toBe("‹redacted›");
    expect("cookie" in byName).toBe(false);
  });

  it("never writes a bearer token into the page", async () => {
    // Built at run time: the page quotes the source around the throwing line, which
    // is this file, so a literal here would be found whatever the page did with it.
    const secret = ["sk", "live", String(Date.now())].join("-");
    const ctx = HttpContext.fake("http://localhost/boom", {
      headers: { authorization: `Bearer ${secret}`, accept: "text/html" },
    });
    const html = await (await renderDevErrorPage(new Error("boom"), ctx)).text();
    expect(html).not.toContain(secret);
  });
});
