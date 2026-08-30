/**
 * The assertion that catches a page which throws on its first paint.
 *
 * An app shipped a blank `/mail` with 614 passing tests. The route answered 200,
 * the Inertia payload was correct, and the browser console said
 * `Cannot read properties of undefined (reading 'search')` — from a layout callback
 * reading `page.props`, which the callback never receives. Every test asserted a
 * value or a status code, so a page could throw and the suite stayed green.
 */
import { describe, it, expect } from "bun:test";
import { renderPage } from "./testing.ts";

const load = async (name: string): Promise<unknown> => {
  const dir = new URL("../resources/pages", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  return (await import(`${dir}/${name}.tsx`)).default;
};

describe("renderPage", () => {
  it("renders a page and returns its markup", async () => {
    const html = await renderPage(await load("HeadPage"), { title: "Kruger" });
    expect(html).toContain("head-page");
    expect(html).toContain("Kruger");
  });

  it("throws what a broken layout callback throws", async () => {
    // This is the whole point. `assertInertia()` passes on this page.
    await expect(renderPage(await load("BrokenLayoutPage"), { title: "x" })).rejects.toThrow(
      /search/,
    );
  });

  it("renders the same layout written correctly, with usePage()", async () => {
    const html = await renderPage(await load("LayoutPage"), { title: "x", search: "inbox" });
    expect(html).toContain("shell");
    expect(html).toContain("inbox");
  });

  it("merges shared props under the page's own", async () => {
    const html = await renderPage(
      await load("LayoutPage"),
      { title: "x" },
      { shared: { search: "from-shared" } },
    );
    expect(html).toContain("from-shared");
  });

  it("lets the page's own props win over a shared one of the same name", async () => {
    const html = await renderPage(
      await load("LayoutPage"),
      { search: "from-page" },
      { shared: { search: "from-shared" } },
    );
    expect(html).toContain("from-page");
  });
});
