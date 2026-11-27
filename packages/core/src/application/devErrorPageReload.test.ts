/**
 * The dev 500 page reloads itself under `zt dev`.
 *
 * It is rendered past the middleware that adds the live-reload client to every other dev page,
 * so a tab showing an error sat on it after the fix was saved and the server had restarted.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { renderDevErrorPage, _devReloadTag } from "./DevErrorPage.ts";

const TAG = '<script src="/__dev/reload.js"></script>';
const before = Bun.env["ZT_DEV"];
afterEach(() => {
  if (before === undefined) delete Bun.env["ZT_DEV"];
  else Bun.env["ZT_DEV"] = before;
});

describe("the dev error page", () => {
  it("loads the live-reload client when the dev worker serves it", async () => {
    Bun.env["ZT_DEV"] = "1";
    const html = await (await renderDevErrorPage(new Error("boom"))).text();

    expect(html).toContain(TAG);
    expect(html.indexOf(TAG)).toBeLessThan(html.indexOf("</body>"));
  });

  it("leaves it out anywhere else, where /__dev/reload.js does not exist", async () => {
    delete Bun.env["ZT_DEV"];
    const html = await (await renderDevErrorPage(new Error("boom"))).text();

    // The tag itself: the page quotes this file's source, which names the path.
    expect(html).not.toContain(TAG);
    expect(_devReloadTag({})).toBe("");
  });
});
