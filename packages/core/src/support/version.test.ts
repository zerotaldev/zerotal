import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("is still the manifest's version inside a compiled binary", async () => {
    // A compiled binary has no file beside a module. Reading the manifest from a path
    // relative to this one crashed every `bun zt compile` binary at start-up, and an
    // unbundled run could never show it, so this compiles the real thing and runs it.
    const manifest = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      version: string;
    };
    const dir = mkdtempSync(join(tmpdir(), "zt-version-compiled-"));
    try {
      const outfile = join(dir, process.platform === "win32" ? "app.exe" : "app");
      const build = Bun.spawn(
        [
          process.execPath,
          "build",
          "--compile",
          "--target=bun",
          `${import.meta.dir}/__fixtures__/compiled-version.ts`,
          `--outfile=${outfile}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [buildErr, buildCode] = await Promise.all([
        new Response(build.stderr).text(),
        build.exited,
      ]);
      if (buildCode !== 0) throw new Error(`bun build --compile exited ${buildCode}: ${buildErr}`);

      // Run from the temp directory, so no manifest is anywhere a relative path could reach.
      const run = Bun.spawn([outfile], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      if (code !== 0) throw new Error(`the compiled binary exited ${code}: ${err}`);
      expect(JSON.parse(out.trim().split("\n").at(-1)!)).toEqual({ version: manifest.version });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
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
