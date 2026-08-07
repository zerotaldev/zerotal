import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneBuildOutput } from "./BuildOutput.ts";

let projectRoot: string;
let outdir: string;
let originalCwd: string;

/** The manifest is written relative to the cwd, so tests run inside a fake app. */
beforeEach(async () => {
  originalCwd = process.cwd();
  projectRoot = await mkdtemp(join(tmpdir(), "zerotal-build-"));
  outdir = join(projectRoot, "public", "assets");
  process.chdir(projectRoot);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(projectRoot, { recursive: true, force: true });
});

/** Write `names` into the output directory as if a build had emitted them. */
async function seed(...names: string[]): Promise<void> {
  for (const name of names) await Bun.write(join(outdir, name), `// ${name}`);
}

/** Shape `pruneBuildOutput` reads from a Bun build result. */
function emitted(...names: string[]): { path: string }[] {
  return names.map((name) => ({ path: join(outdir, name) }));
}

async function remaining(): Promise<string[]> {
  return (await readdir(outdir)).sort();
}

describe("pruneBuildOutput()", () => {
  it("removes the chunks a rebuild replaced and keeps the new ones", async () => {
    await seed("app.js", "chunk-old1.js", "chunk-old1.js.map", "chunk-new2.js");

    const removed = await pruneBuildOutput(outdir, emitted("app.js", "chunk-new2.js"));

    expect(removed).toEqual(["chunk-old1.js", "chunk-old1.js.map"]);
    expect(await remaining()).toEqual(["app.js", "chunk-new2.js"]);
  });

  it("sweeps chunks left behind before any manifest existed", async () => {
    // The state a project is in on its first build after this cleanup lands:
    // hundreds of dead chunks and no record of who wrote them.
    await seed("app.js", ...Array.from({ length: 50 }, (_, i) => `chunk-stale${i}.js`));

    const removed = await pruneBuildOutput(outdir, emitted("app.js"));

    expect(removed).toHaveLength(50);
    expect(await remaining()).toEqual(["app.js"]);
  });

  it("leaves files it did not write alone", async () => {
    // An outdir is often `public/`, where everything else belongs to the app.
    await seed("app.js", "logo.png", "favicon.ico", "robots.txt");

    const removed = await pruneBuildOutput(outdir, emitted("app.js"));

    expect(removed).toEqual([]);
    expect(await remaining()).toEqual(["app.js", "favicon.ico", "logo.png", "robots.txt"]);
  });

  it("removes a non-chunk output the next build stopped emitting", async () => {
    await seed("app.js", "admin.js", "app.css");
    await pruneBuildOutput(outdir, emitted("app.js", "admin.js", "app.css"));

    // `admin.js` was ours last time and is not in this build — it goes. The
    // hand-placed file was never ours, so it stays.
    await seed("vendor.js");
    const removed = await pruneBuildOutput(outdir, emitted("app.js", "app.css"));

    expect(removed).toEqual(["admin.js"]);
    expect(await remaining()).toEqual(["app.css", "app.js", "vendor.js"]);
  });

  it("keeps separate records per output directory", async () => {
    const other = join(projectRoot, "public", "admin");
    await seed("app.js");
    await Bun.write(join(other, "app.js"), "// other");

    await pruneBuildOutput(outdir, emitted("app.js"));
    await pruneBuildOutput(other, [{ path: join(other, "app.js") }]);

    // Pruning the second directory must not decide the first one's output is stale.
    expect(await remaining()).toEqual(["app.js"]);
    expect(await readdir(other)).toEqual(["app.js"]);
  });

  it("survives an output directory that does not exist", async () => {
    expect(await pruneBuildOutput(join(projectRoot, "nope"), [])).toEqual([]);
  });

  it("keeps the manifest out of the served directory", async () => {
    await seed("app.js");
    await pruneBuildOutput(outdir, emitted("app.js"));

    expect(await remaining()).toEqual(["app.js"]);
    expect((await readdir(join(projectRoot, ".zerotal", "build"))).length).toBe(1);
  });
});
