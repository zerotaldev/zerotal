import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootBuildDecision, isWritableDir } from "./bootBuild.ts";

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `zt-bootbuild-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("isWritableDir", () => {
  it("creates a missing directory and reports it writable", async () => {
    expect(await isWritableDir(join(root, "public/css"))).toBe(true);
  });

  it("leaves no probe file behind", async () => {
    const dir = join(root, "public");
    await isWritableDir(dir);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports a path it cannot create as unwritable", async () => {
    // A directory cannot be created under a regular file, on any platform.
    await Bun.write(join(root, "blocker"), "");
    expect(await isWritableDir(join(root, "blocker/public"))).toBe(false);
  });
});

describe("bootBuildDecision", () => {
  it("always builds outside a production-like deployment", async () => {
    for (const env of ["development", "test", "local", undefined]) {
      expect(await bootBuildDecision([join(root, "public")], env)).toEqual({ build: true });
    }
  });

  it("builds in production when the output directory is writable", async () => {
    expect(await bootBuildDecision([join(root, "public")], "production")).toEqual({ build: true });
  });

  it("treats staging as production-like", async () => {
    // A staging box is hardened like a production one. It used to build at boot
    // regardless of whether its output directory was writable — the one remaining
    // environment where the read-only restart loop was still reachable.
    await Bun.write(join(root, "blocker"), "");
    const decision = await bootBuildDecision([join(root, "blocker/public")], "staging");
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("not writable");
  });

  it("skips, with a reason, when production output is read-only", async () => {
    // The failure this exists for: a hardened unit restart-looping on
    // `Read-only file system: writing chunk "./app.css"`.
    await Bun.write(join(root, "blocker"), "");
    const decision = await bootBuildDecision([join(root, "blocker/public")], "production");
    expect(decision.build).toBe(false);
    expect(decision.reason).toContain("not writable");
    expect(decision.reason).toContain("deploy time");
  });

  it("skips when any one of several output directories is read-only", async () => {
    await Bun.write(join(root, "blocker"), "");
    const decision = await bootBuildDecision(
      [join(root, "public/css"), join(root, "blocker/js")],
      "prod",
    );
    expect(decision.build).toBe(false);
  });
});

/** POSIX-only: mode bits are advisory on Windows, so this would be a false pass there. */
describe.skipIf(process.platform === "win32")("bootBuildDecision on a chmod'd directory", () => {
  it("treats a mode 0o500 directory as unwritable", async () => {
    const dir = join(root, "readonly");
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      expect(await isWritableDir(dir)).toBe(false);
      expect((await bootBuildDecision([dir], "production")).build).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
