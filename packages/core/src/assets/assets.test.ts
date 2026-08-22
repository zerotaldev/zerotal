import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  asset,
  configureAssets,
  assetVersion,
  setAssetVersion,
  bumpAssetVersion,
  deriveAssetVersion,
} from "./assets.ts";

beforeEach(() => {
  // Reset to defaults between cases (module-level state).
  configureAssets({ prefix: "/", dev: false });
  setAssetVersion("");
});

describe("asset()", () => {
  it("joins the prefix and path with a single slash", () => {
    expect(asset("/app.css")).toBe("/app.css");
    expect(asset("app.css")).toBe("/app.css");
  });

  it("honours a non-root prefix", () => {
    configureAssets({ prefix: "/assets" });
    expect(asset("/app.css")).toBe("/assets/app.css");
    expect(asset("app.js")).toBe("/assets/app.js");
  });

  it("normalises a trailing slash on the prefix", () => {
    configureAssets({ prefix: "/assets/" });
    expect(asset("app.css")).toBe("/assets/app.css");
  });

  it("appends ?v= in production too", () => {
    // This asserted the opposite until 1.7.5, and the opposite was the bug: a
    // deploy rewrites `app.js` under the same name, the static handler sends no
    // `Cache-Control`, and so a returning visitor kept the bundle their browser
    // had cached while every check on the server said the deploy worked.
    configureAssets({ dev: false });
    setAssetVersion("abc");
    expect(asset("/app.css")).toBe("/app.css?v=abc");
  });

  it("appends ?v=<version> in dev when a version is set", () => {
    configureAssets({ dev: true });
    setAssetVersion("abc");
    expect(asset("/app.css")).toBe("/app.css?v=abc");
  });

  it("omits ?v= in dev when no version is set", () => {
    configureAssets({ dev: true });
    setAssetVersion("");
    expect(asset("/app.css")).toBe("/app.css");
  });

  it("uses & when the path already has a query string", () => {
    configureAssets({ dev: true });
    setAssetVersion("abc");
    expect(asset("/app.css?foo=1")).toBe("/app.css?foo=1&v=abc");
  });
});

describe("asset versioning", () => {
  it("reports the current version", () => {
    setAssetVersion("xyz");
    expect(assetVersion()).toBe("xyz");
  });

  it("bumpAssetVersion() produces a fresh non-empty token", () => {
    const next = bumpAssetVersion();
    expect(next).not.toBe("");
    expect(assetVersion()).toBe(next);
  });
});

describe("deriveAssetVersion()", () => {
  // The production token. Its three properties are the whole contract: it exists,
  // it does not move when nothing moved, and it moves when something did. Each was
  // verified by hand against a real server before this was written; this is what
  // keeps them true.
  const dir = join(tmpdir(), `zt-assets-${Bun.hash(String(process.pid)).toString(36)}`);

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "js"), { recursive: true });
    writeFileSync(join(dir, "js", "app.js"), "console.log(1)");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("derives a token from the built files", () => {
    expect(deriveAssetVersion(dir)).toMatch(/^[a-z0-9]+$/);
  });

  it("is stable when nothing changed", () => {
    // A restart that rebuilt nothing must not invalidate every client's cache.
    expect(deriveAssetVersion(dir)).toBe(deriveAssetVersion(dir));
  });

  it("changes when a file changes", () => {
    const before = deriveAssetVersion(dir);
    writeFileSync(join(dir, "js", "app.js"), "console.log(2) // longer");
    expect(deriveAssetVersion(dir)).not.toBe(before);
  });

  it("changes when a file is added", () => {
    const before = deriveAssetVersion(dir);
    writeFileSync(join(dir, "js", "extra.js"), "x");
    expect(deriveAssetVersion(dir)).not.toBe(before);
  });

  it("is empty for a directory that is not there", () => {
    // An app with no built assets gets clean URLs rather than a meaningless token.
    expect(deriveAssetVersion(join(dir, "nope"))).toBe("");
  });
});
