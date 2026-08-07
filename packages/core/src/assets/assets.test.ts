import { describe, it, expect, beforeEach } from "bun:test";
import {
  asset,
  configureAssets,
  assetVersion,
  setAssetVersion,
  bumpAssetVersion,
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

  it("does NOT append ?v= in production (dev off)", () => {
    configureAssets({ dev: false });
    setAssetVersion("abc");
    expect(asset("/app.css")).toBe("/app.css");
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
