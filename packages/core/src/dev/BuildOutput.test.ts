import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneBuildOutput, cleanBuildOutput } from "./BuildOutput.ts";

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

/**
 * `--clean`: for output the prune cannot recognise as output.
 *
 * Pruning removes what it can identify — a manifest entry, or a filename shaped
 * the way `Bun.build()` shapes a code-split chunk. Measured across ten releases
 * into one directory, that holds it steady at exactly the build's own output,
 * with or without a manifest to compare against. The gap is not releases; it is
 * naming. Output that arrived under some other convention is invisible to both
 * rules, and stays.
 *
 * Which is worth stating because stale bundles are not only clutter: they remain
 * publicly fetchable at their content-hashed URLs, so a page whose copy was
 * withdrawn is still readable by anyone holding the link.
 */
describe("cleanBuildOutput()", () => {
  it("removes everything this build did not write, chunk-named or not", async () => {
    await seed("app.js", "legacy-a1b2c3.js", "pricing-9f8e7d.js", "chunk-old.js", "app.css");

    const removed = await cleanBuildOutput(outdir, emitted("app.js", "app.css"));

    expect(removed).toEqual(["chunk-old.js", "legacy-a1b2c3.js", "pricing-9f8e7d.js"]);
    expect(await remaining()).toEqual(["app.css", "app.js"]);
  });

  it("catches what the prune's name rule does not recognise", async () => {
    // The two spellings side by side, against a directory with no manifest —
    // which is what a first build on a new machine sees. `chunk-…` is the shape
    // `Bun.build()` emits and the prune knows it; `Pricing-…` is what some other
    // naming produces, and nothing about it says "build output".
    await seed("app.js", "chunk-2502z4dn.js", "Pricing-9f8e7d1c.js");

    const pruned = await pruneBuildOutput(outdir, emitted("app.js"));
    expect(pruned).toEqual(["chunk-2502z4dn.js"]);
    expect(await remaining()).toEqual(["Pricing-9f8e7d1c.js", "app.js"]);

    const cleaned = await cleanBuildOutput(outdir, emitted("app.js"));
    expect(cleaned).toEqual(["Pricing-9f8e7d1c.js"]);
  });

  it("reaches into nested directories", async () => {
    await seed("app.js", join("pages", "old.js"));

    await cleanBuildOutput(outdir, emitted("app.js"));

    expect(await readdir(join(outdir, "pages"))).toEqual([]);
  });

  it("refuses the public directory, which holds more than the build's output", async () => {
    // The failure this prevents is unrecoverable: an app's images, favicon and
    // robots.txt are not rebuilt by anything, so deleting them is permanent.
    const publicDir = join(projectRoot, "public");
    await Bun.write(join(publicDir, "favicon.ico"), "icon");

    await expect(cleanBuildOutput(publicDir, [])).rejects.toThrow(/Refusing to clean/);
    expect(await Bun.file(join(publicDir, "favicon.ico")).exists()).toBe(true);
  });

  it("refuses the project root", async () => {
    await expect(cleanBuildOutput(projectRoot, [])).rejects.toThrow(/Refusing to clean/);
  });

  it("leaves a directory holding exactly this build's output alone", async () => {
    await seed("app.js", "chunk-live.js");

    const removed = await cleanBuildOutput(outdir, emitted("app.js", "chunk-live.js"));

    expect(removed).toEqual([]);
    expect(await remaining()).toEqual(["app.js", "chunk-live.js"]);
  });

  it("records what it wrote, so a later prune knows the same set", async () => {
    await seed("app.js", "stale.js");
    await cleanBuildOutput(outdir, emitted("app.js"));

    // Same build again, this time through the conservative path: the manifest
    // `clean` left behind is what lets it recognise a file it did not name.
    await seed("later.js");
    const removed = await pruneBuildOutput(outdir, emitted("app.js", "later.js"));

    expect(removed).toEqual([]);
    expect(await remaining()).toEqual(["app.js", "later.js"]);
  });
});
