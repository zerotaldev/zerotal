/**
 * `injectHead` is the half of the `<Head>` fix that decides *where* the tags go,
 * and getting that wrong is invisible: appended tags are present in the markup,
 * valid, and ignored by the browser and every scraper, which read the first title
 * and the first meta of a given name.
 */
import { describe, it, expect } from "bun:test";
import { injectHead } from "./head.ts";

const TEMPLATE = "<html><head><title>Zerotal</title></head><body></body></html>";

describe("injectHead", () => {
  it("returns the prefix untouched when there is nothing to inject", () => {
    expect(injectHead(TEMPLATE, [])).toBe(TEMPLATE);
  });

  it("replaces the template's title rather than adding a second one", () => {
    const html = injectHead(TEMPLATE, ["<title>Trip</title>"]);
    expect(html).toContain("<title>Trip</title>");
    expect(html.match(/<title/g)?.length).toBe(1);
  });

  it("appends a title when the template has none", () => {
    const html = injectHead("<html><head></head></html>", ["<title>Trip</title>"]);
    expect(html).toBe("<html><head><title>Trip</title></head></html>");
  });

  it("matches a meta on name and on property, and leaves the rest alone", () => {
    const template =
      '<head><meta charset="utf-8"><meta name="description" content="old">' +
      '<meta property="og:title" content="old"></head>';
    const html = injectHead(template, [
      '<meta name="description" content="new">',
      '<meta property="og:title" content="new">',
    ]);

    expect(html).not.toContain('content="old"');
    expect(html.match(/name="description"/g)?.length).toBe(1);
    expect(html.match(/property="og:title"/g)?.length).toBe(1);
    // A meta with neither name nor property has no identity to match on.
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("appends a meta the template does not declare", () => {
    const html = injectHead(TEMPLATE, ['<meta name="robots" content="noindex">']);
    expect(html).toContain('<meta name="robots" content="noindex"></head>');
  });

  it("does not confuse a description with a longer name that contains it", () => {
    // `name="description"` must not match `name="og:description"`, which a
    // substring search would.
    const template = '<head><meta name="og:description" content="keep"></head>';
    const html = injectHead(template, ['<meta name="description" content="new">']);
    expect(html).toContain('content="keep"');
    expect(html).toContain('content="new"');
  });

  it("appends when the template has no </head> to insert before", () => {
    const html = injectHead("<div>fragment</div>", ["<title>Trip</title>"]);
    expect(html).toBe("<div>fragment</div><title>Trip</title>");
  });

  it("inserts before the first </head>, not one that appears later in the page", () => {
    // A template that documents its own markup has the literal string in the body.
    // Splicing at the last match puts the title outside the head entirely.
    const template = "<head><title>Docs</title></head><body><pre></head></pre></body>";
    const html = injectHead(template, ['<meta name="robots" content="noindex">']);
    expect(html.indexOf("robots")).toBeLessThan(html.indexOf("<body>"));
  });
});
