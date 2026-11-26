import { describe, it, expect } from "bun:test";
import { distTagFor } from "./dist-tag.ts";

describe("distTagFor", () => {
  it("leaves a release on the newest line under `latest`", () => {
    expect(distTagFor("1.18.1", "1.18.0")).toBeUndefined();
    expect(distTagFor("1.19.0", "1.18.4")).toBeUndefined();
    expect(distTagFor("2.0.0", "1.21.3")).toBeUndefined();
  });

  it("gives a security fix on an older line its own tag, so `latest` does not move back", () => {
    expect(distTagFor("1.17.5", "1.18.1")).toBe("release-1.17");
    expect(distTagFor("1.21.4", "2.0.1")).toBe("release-1.21");
  });

  it("falls back to `latest` when the registry gave nothing usable", () => {
    expect(distTagFor("1.17.5", undefined)).toBeUndefined();
    expect(distTagFor("1.17.5", "")).toBeUndefined();
  });

  it("treats a re-run of the current version as the newest line", () => {
    expect(distTagFor("1.18.1", "1.18.1")).toBeUndefined();
  });

  it("never produces a tag npm would read as a version range", () => {
    // npm refuses a dist-tag its semver parser accepts as a range. A range starts
    // with a digit, an operator, `v`, `x` or `*`; a word followed by a hyphen does not.
    const tag = distTagFor("1.17.5", "1.18.0")!;
    expect(tag).toBe("release-1.17");
    expect(tag).not.toMatch(/^[\dvVxX*<>=~^]/);
  });
});
