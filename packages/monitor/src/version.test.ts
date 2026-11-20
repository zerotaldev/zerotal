import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZEROTAL_VERSION, ZEROTAL_VERSION_TAG } from "./version.ts";

async function manifestVersion(): Promise<string> {
  const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    version: string;
  };
  return manifest.version;
}

describe("ZEROTAL_VERSION", () => {
  it("is this package's own version, not a copy of it", async () => {
    const version = await manifestVersion();
    expect(ZEROTAL_VERSION).toBe(version);
    expect(ZEROTAL_VERSION_TAG).toBe(`v${version}`);
  });

  it("is still the manifest's version inside a compiled binary", async () => {
    // A compiled binary has no file beside a module, so reading the manifest from a
    // path relative to this one crashed any `bun zt compile` binary that loaded the
    // monitor. An unbundled run can never show that, so this compiles one and runs it.
    const dir = mkdtempSync(join(tmpdir(), "zt-monitor-version-compiled-"));
    try {
      const entry = join(dir, "entry.ts");
      const source = JSON.stringify(`${import.meta.dir}/version.ts`.replaceAll("\\", "/"));
      writeFileSync(
        entry,
        `import { ZEROTAL_VERSION } from ${source};\nconsole.log(JSON.stringify({ version: ZEROTAL_VERSION }));\n`,
      );
      const outfile = join(dir, process.platform === "win32" ? "app.exe" : "app");
      const build = Bun.spawn(
        [process.execPath, "build", "--compile", "--target=bun", entry, `--outfile=${outfile}`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [buildErr, buildCode] = await Promise.all([
        new Response(build.stderr).text(),
        build.exited,
      ]);
      if (buildCode !== 0) throw new Error(`bun build --compile exited ${buildCode}: ${buildErr}`);

      const run = Bun.spawn([outfile], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      if (code !== 0) throw new Error(`the compiled binary exited ${code}: ${err}`);
      expect(JSON.parse(out.trim().split("\n").at(-1)!)).toEqual({
        version: await manifestVersion(),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
