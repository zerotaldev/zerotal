/**
 * One page, one URL.
 *
 * `docs/testing/index.md` used to answer on three: `/docs/testing`, because the
 * resolver falls back to `<slug>/index.md`; `/docs/testing/index`, the file's own
 * path; and `/docs/testing/`, because the trailing slash is trimmed before the
 * slug is resolved. All three returned 200, and each named *itself* in
 * `<link rel="canonical">` — the tag is built from the request path, so it agreed
 * with whichever form you happened to ask for.
 *
 * The sitemap had already picked a side: `listDocSlugs` strips `/index`, so it has
 * only ever offered `/docs/testing`. These pin the server to the same answer.
 */
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { canonicalPath, parseSlug, listDocSlugs, docPath } from "@app/support/helpers.ts";

/** The repository's `docs/`, reached from this file rather than from a booted app. */
const CORPUS = join(import.meta.dir, "../../../docs");

describe("canonicalPath", () => {
  it("leaves the canonical form alone", () => {
    // `null` means "already canonical" — the caller renders instead of redirecting.
    expect(canonicalPath("/docs/testing")).toBeNull();
    expect(canonicalPath("/docs/orm/casts")).toBeNull();
    expect(canonicalPath("/docs")).toBeNull();
  });

  it("strips a trailing slash", () => {
    expect(canonicalPath("/docs/testing/")).toBe("/docs/testing");
    expect(canonicalPath("/docs/")).toBe("/docs");
  });

  it("strips a trailing /index", () => {
    expect(canonicalPath("/docs/testing/index")).toBe("/docs/testing");
    expect(canonicalPath("/docs/orm/index")).toBe("/docs/orm");
  });

  it("reduces /docs/index to the overview", () => {
    // Not to `""`. The overview is a real page and this is the URL the homepage
    // links to, so getting it wrong would 404 the site's front door.
    expect(canonicalPath("/docs/index")).toBe("/docs");
  });

  it("handles both at once", () => {
    // The slash has to go first, or the `/index` is still hidden behind it.
    expect(canonicalPath("/docs/testing/index/")).toBe("/docs/testing");
  });

  it("does not touch a slug that merely contains the word", () => {
    // `indexes` and `index-signatures` are real documentation subjects; a suffix
    // match without the separator would redirect them into nowhere.
    expect(canonicalPath("/docs/orm/indexes")).toBeNull();
    expect(canonicalPath("/docs/reindex")).toBeNull();
  });

  it("leaves the API tree's README form alone", () => {
    // TypeDoc directories redirect to `<slug>/README` so their relative links
    // resolve. That is a different canonical form, and this must not fight it.
    expect(canonicalPath("/docs/api/core/README")).toBeNull();
  });
});

describe("the canonical form and the sitemap agree", () => {
  it("offers no URL that would immediately redirect", async () => {
    // The failure this catches: a sitemap listing `/docs/testing/index` while the
    // server 301s it away, which asks a crawler to follow a redirect for every
    // page it was told to visit.
    const redirecting = (await listDocSlugs(CORPUS))
      .map(docPath)
      .filter((path) => canonicalPath(path) !== null);

    expect(redirecting).toEqual([]);
  });

  it("resolves the canonical path back to the same slug", async () => {
    // `/docs/testing` must still find `docs/testing/index.md` after the redirect —
    // the normalisation removes a URL, not a page.
    expect(parseSlug("/docs/testing")).toBe("testing");
    expect(parseSlug(canonicalPath("/docs/testing/index")!)).toBe("testing");
    expect(parseSlug(canonicalPath("/docs/index")!)).toBe("index");
  });
});
