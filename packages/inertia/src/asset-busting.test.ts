/**
 * The entry point is not content-hashed and the chunks are.
 *
 * `resources/js/app.tsx` builds to `/assets/app.js` under that name every time,
 * while `splitting: true` names each chunk after its content. So a rebuild
 * rewrites `app.js` to import `chunk-NEW.js` and prunes `chunk-OLD.js` — and a
 * browser holding a cached `app.js` asks for a chunk that is no longer on disk.
 *
 * The report that produced this test is what the failure looks like from the
 * outside:
 *
 *     GET /assets/chunk-hrnspqda.js  status=404
 *
 * A page that renders, a server that is healthy, and a 404 for a file nobody
 * referenced on purpose. Nothing in that line leads back to the template.
 *
 * The template hardcodes `/assets/app.js` rather than calling `asset()`, so the
 * version token the rest of the framework appends never reached it. Busting was
 * implemented for `--dev-worker` only, which is the one environment where the
 * problem is least likely to be noticed and most likely to be blamed on the
 * browser.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { setAssetVersion as setCoreAssetVersion } from "@zerotal/core/assets";
import { _setHtmlTemplate, _bustAssets, _resetBustedTemplate } from "./inertia.ts";

const TEMPLATE = [
  "<!doctype html><html><head>",
  '<link rel="stylesheet" href="/assets/app.css" />',
  '<script type="module" src="/assets/app.js"></script>',
  '<link rel="icon" href="/zt.svg" type="image/svg+xml" />',
  '<script src="https://cdn.example.test/thing.js"></script>',
  "</head><body><!-- @inertia --></body></html>",
].join("\n");

/**
 * What the render path does: cache the template, then bust it. Both renderers
 * call `_bustAssets(_htmlTemplate)`, so this is the same code with no request.
 */
function bust(html: string): string {
  _setHtmlTemplate(html);
  return _bustAssets(html);
}

beforeEach(() => {
  _resetBustedTemplate();
  setCoreAssetVersion("");
});

afterEach(() => {
  setCoreAssetVersion("");
  _resetBustedTemplate();
});

describe("the cached template and a rebuilt bundle", () => {
  it("stamps the asset token onto local JS and CSS", () => {
    setCoreAssetVersion("abc123");
    const out = bust(TEMPLATE);

    expect(out).toContain('src="/assets/app.js?v=abc123"');
    expect(out).toContain('href="/assets/app.css?v=abc123"');
  });

  it("changes the entry URL when the build changes, which is the whole fix", () => {
    setCoreAssetVersion("build-one");
    const before = bust(TEMPLATE);

    _resetBustedTemplate();
    setCoreAssetVersion("build-two");
    const after = bust(TEMPLATE);

    // Same file name, different URL. A browser that cached the first fetches the
    // second, so it never asks for a chunk the rebuild pruned.
    expect(before).toContain("/assets/app.js?v=build-one");
    expect(after).toContain("/assets/app.js?v=build-two");
    expect(before).not.toBe(after);
  });

  it("leaves the URL alone when nothing derived a token", () => {
    setCoreAssetVersion("");
    const out = bust(TEMPLATE);

    // Stamping `?v=` with no value would invent a second URL for the same file
    // and buy nothing.
    expect(out).toContain('src="/assets/app.js"');
    expect(out).not.toContain("?v=");
  });

  it("does not touch a cross-origin script", () => {
    setCoreAssetVersion("abc123");
    const out = bust(TEMPLATE);

    // Appending a query to somebody else's CDN URL is not ours to do, and can
    // miss their cache entirely.
    expect(out).toContain('src="https://cdn.example.test/thing.js"');
  });

  it("does not touch assets that are neither JS nor CSS", () => {
    setCoreAssetVersion("abc123");
    const out = bust(TEMPLATE);
    expect(out).toContain('href="/zt.svg"');
  });

  it("keeps a stable URL while the build does not change", () => {
    setCoreAssetVersion("same");
    const first = bust(TEMPLATE);
    const second = bust(TEMPLATE);

    // A derived token rather than a random one is what lets an unchanged asset
    // stay cached across restarts.
    expect(first).toBe(second);
  });

  it("forgets the memoised copy when the template itself is replaced", () => {
    setCoreAssetVersion("same-token");
    bust(TEMPLATE);

    const replaced = TEMPLATE.replace("app.js", "main.js");
    const out = bust(replaced);

    // Same token, different template. Serving the memo here would return the old
    // markup for as long as the token happened to match.
    expect(out).toContain("/assets/main.js?v=same-token");
    expect(out).not.toContain("/assets/app.js?v=");
  });
});
