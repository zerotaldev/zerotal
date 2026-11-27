/**
 * Every restart reloads a tab that is waiting on the server.
 *
 * The token a tab is sent on connect used to be the asset build's alone, so a restart that
 * rebuilt nothing (an API, a skipped build, a fix to a 500) left the tab on the old page.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { _reloadToken } from "./DevWsServer.ts";
import { setAssetVersion } from "../assets/assets.ts";
import { _DEV_RELOAD_SOURCE } from "./reloadClient.ts";

afterEach(() => setAssetVersion(""));

describe("_reloadToken()", () => {
  it("differs between two boots that serve the same build", () => {
    setAssetVersion("abc");
    const first = _reloadToken({ ZT_DEV_BOOT_ID: "s-1" });
    const second = _reloadToken({ ZT_DEV_BOOT_ID: "s-2" });

    expect(first).not.toBe(second);
    expect(first).toContain("abc");
  });

  it("changes with the build inside one boot", () => {
    setAssetVersion("abc");
    const before = _reloadToken({ ZT_DEV_BOOT_ID: "s-1" });
    setAssetVersion("def");
    expect(_reloadToken({ ZT_DEV_BOOT_ID: "s-1" })).not.toBe(before);
  });

  it("is the build token alone outside `zt dev`", () => {
    setAssetVersion("abc");
    expect(_reloadToken({})).toBe("abc");
  });

  it("is what the client compares: it reloads on any token it has not seen first", () => {
    expect(_DEV_RELOAD_SOURCE).toContain("else if(build!==v)location.reload();");
  });
});
