import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZEROTAL_VERSION, installedCoreVersion } from "./version.ts";

describe("ZEROTAL_VERSION", () => {
  it("is this package's own version, not a copy of it", async () => {
    const manifest = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      version: string;
    };
    expect(ZEROTAL_VERSION).toBe(manifest.version);
  });
});

describe("installedCoreVersion", () => {
  function project(version?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "zt-version-"));
    if (version !== undefined) {
      const pkgDir = join(dir, "node_modules", "@zerotal", "core");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version }));
    }
    return dir;
  }

  it("reads what is installed, which need not be what is running", () => {
    expect(installedCoreVersion(project("9.9.9"))).toBe("9.9.9");
  });

  it("returns null when there is nothing installed to read", () => {
    // A workspace checkout and a hoisted layout both land here. Absence is not a
    // finding — a caller that treated it as one would warn on every monorepo run.
    expect(installedCoreVersion(project())).toBeNull();
  });

  it("returns null rather than throwing on an unreadable manifest", () => {
    const dir = project();
    const pkgDir = join(dir, "node_modules", "@zerotal", "core");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), "{ not json");
    expect(installedCoreVersion(dir)).toBeNull();
  });
});
