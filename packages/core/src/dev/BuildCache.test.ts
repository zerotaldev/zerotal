import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BuildCache, fingerprintTree } from "./BuildCache.ts";
import { pruneBuildOutput } from "./BuildOutput.ts";
import { isDevOrchestrated } from "../support/env.ts";

let root: string;
let previousCwd: string;

/** Write a file, creating parents. */
async function write(path: string, contents: string): Promise<string> {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
  return full;
}

/** Build the fixture app and return the standard cache key for it. */
function keyFor(overrides: Partial<Parameters<typeof BuildCache.for>[0]> = {}) {
  return {
    entrypoints: [join(root, "resources/js/app.ts")],
    outdir: join(root, "public"),
    minify: false,
    ...overrides,
  };
}

/** Run the real bundler against the fixture. */
async function build(): Promise<Awaited<ReturnType<typeof Bun.build>>> {
  return await Bun.build({
    entrypoints: [join(root, "resources/js/app.ts")],
    outdir: join(root, "public"),
    target: "browser",
    sourcemap: "external",
    splitting: true,
  });
}

beforeEach(async () => {
  root = join(tmpdir(), `zt-buildcache-${Bun.randomUUIDv7()}`);
  await mkdir(root, { recursive: true });

  await write(
    "resources/js/app.ts",
    `import { helper } from "./helper.ts";\nconsole.log(helper());\nconst lazy = () => import("./lazy.ts");\nconsole.log(lazy);\n`,
  );
  await write("resources/js/helper.ts", `export const helper = () => "hi";\n`);
  await write("resources/js/lazy.ts", `export default { name: "lazy" };\n`);
  await write("app/views/home.tsx", `export const Home = () => <div className="p-4" />;\n`);

  // BuildCache writes into `<cwd>/.zerotal/build`, so the fixture must be cwd.
  previousCwd = process.cwd();
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
  delete Bun.env["ZT_NO_BUILD_CACHE"];
});

describe("BuildCache", () => {
  it("is not fresh before anything has been recorded", async () => {
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("is fresh after a build when nothing has changed", async () => {
    const cache = BuildCache.for(keyFor(), root);
    const result = await build();
    expect(result.success).toBe(true);

    await cache.record(result.outputs);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);
  });

  it("invalidates when a directly-imported source changes", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);

    await write("resources/js/helper.ts", `export const helper = () => "changed";\n`);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("invalidates when a lazily-imported source changes", async () => {
    // The case a naive entrypoint-only fingerprint misses: `lazy.ts` is reached
    // only through a dynamic import, so it appears in a split chunk's sourcemap
    // rather than the entry's.
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);

    await write("resources/js/lazy.ts", `export default { name: "different" };\n`);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("invalidates when the entry point itself changes", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    await write("resources/js/app.ts", `console.log("rewritten");\n`);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("ignores a change to a file the bundle does not contain", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    await write("resources/js/unrelated.ts", `export const nope = 1;\n`);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);
  });

  it("tracks scanned trees, for Tailwind's @source globs", async () => {
    // A stylesheet's inputs are templates, which no sourcemap knows about.
    const cache = BuildCache.for(keyFor({ extra: { kind: "css" } }), root);
    await cache.record((await build()).outputs, { scanRoots: [join(root, "app")] });
    expect(await BuildCache.for(keyFor({ extra: { kind: "css" } }), root).isFresh()).toBe(true);

    // A new utility class in a template must rebuild the stylesheet.
    await write("app/views/home.tsx", `export const Home = () => <div className="p-8 gap-2" />;\n`);

    expect(await BuildCache.for(keyFor({ extra: { kind: "css" } }), root).isFresh()).toBe(false);
  });

  it("invalidates when an output has been deleted", async () => {
    const cache = BuildCache.for(keyFor(), root);
    const result = await build();
    await cache.record(result.outputs);
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);

    // `rm -rf public/` must always recover, whatever the cache believes.
    await rm(join(root, "public"), { recursive: true, force: true });

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("invalidates when the build configuration changes", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    expect(await BuildCache.for(keyFor({ minify: true }), root).isFresh()).toBe(false);
    expect(await BuildCache.for(keyFor({ loader: { ".woff2": "file" } }), root).isFresh()).toBe(
      false,
    );
    expect(await BuildCache.for(keyFor({ plugins: ["tailwind"] }), root).isFresh()).toBe(false);
    expect(
      await BuildCache.for(
        keyFor({ entrypoints: [join(root, "resources/js/other.ts")] }),
        root,
      ).isFresh(),
    ).toBe(false);
  });

  it("invalidates when the Bun version changes", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    // Rewrite the stored entry as if a previous Bun had produced it.
    const dir = join(root, ".zerotal/build");
    const [file] = (await readdir(dir)).filter((name) => name.startsWith("cache-"));
    const path = join(dir, file!);
    const entry = (await Bun.file(path).json()) as { bun: string };
    entry.bun = "0.0.1-ancient";
    await writeFile(path, JSON.stringify(entry));

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("builds rather than throwing on a corrupt cache file", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    const dir = join(root, ".zerotal/build");
    for (const name of await readdir(dir)) {
      await writeFile(join(dir, name), "{ not json at all");
    }

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("never reports fresh with an empty input set", async () => {
    // An entry recording nothing would otherwise be fresh forever.
    const cache = BuildCache.for(keyFor({ entrypoints: [] }), root);
    await cache.record([]);

    expect(await BuildCache.for(keyFor({ entrypoints: [] }), root).isFresh()).toBe(false);
  });

  it("is disabled by ZT_NO_BUILD_CACHE", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);

    Bun.env["ZT_NO_BUILD_CACHE"] = "1";
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("keeps separate entries for two bundles sharing an output directory", async () => {
    // Flow builds CSS and JS into the same `public/`. One shared record would
    // let a CSS build satisfy a JS cache check.
    const css = BuildCache.for(keyFor({ extra: { kind: "css" } }), root);
    await css.record((await build()).outputs);

    expect(await BuildCache.for(keyFor({ extra: { kind: "css" } }), root).isFresh()).toBe(true);
    expect(await BuildCache.for(keyFor({ extra: { kind: "js" } }), root).isFresh()).toBe(false);
  });

  it("notices an edit that leaves the file the same size", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);

    // Same byte count, different contents — caught by mtime, not size.
    const target = await write("resources/js/helper.ts", `export const helper = () => "HI";\n`);

    // Move the mtime explicitly. `fingerprintTree` is `mtimeMs:size` by design, and
    // the docblock there names this exact gap: a same-size edit that lands inside
    // one mtime tick is invisible to it. Rewriting the file within the same tick is
    // how this test failed under a loaded parallel run while passing on its own —
    // the assertion was really about clock resolution, not about the cache.
    const future = new Date(Date.now() + 10_000);
    await utimes(target, future, future);

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });

  it("invalidate() forces the next build", async () => {
    const cache = BuildCache.for(keyFor(), root);
    await cache.record((await build()).outputs);
    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(true);

    await cache.invalidate();

    expect(await BuildCache.for(keyFor(), root).isFresh()).toBe(false);
  });
});

describe("BuildCache + pruneBuildOutput", () => {
  it("a skipped build prunes nothing, even if a call site forgets to return early", async () => {
    // This used to be the sharpest edge in the design: a skipped build has no
    // `outputs`, every recorded file was therefore stale, and one prune emptied
    // the directory. The call sites return before pruning, and that was the only
    // thing standing between a cache hit and a deleted release.
    //
    // Recording which build wrote what took the edge off. An empty `outputs` list
    // names no entry point, so it is nobody's build, and files another build has
    // claimed are not its to remove. The early return is still right — there is
    // nothing to do after a skip — but it is now an optimisation rather than the
    // last line of defence.
    const outdir = join(root, "public");
    const result = await build();
    expect(result.success).toBe(true);

    await pruneBuildOutput(outdir, result.outputs);
    const afterRealBuild = (await readdir(outdir)).sort();
    expect(afterRealBuild.length).toBeGreaterThan(0);

    await pruneBuildOutput(outdir, []);
    expect((await readdir(outdir)).sort()).toEqual(afterRealBuild);
  });

  it("pruning after a real build keeps that build's outputs", async () => {
    const outdir = join(root, "public");
    const result = await build();

    await pruneBuildOutput(outdir, result.outputs);

    const remaining = await readdir(outdir);
    expect(remaining).toContain("app.js");
  });
});

describe("fingerprintTree", () => {
  it("stamps every file under a root", async () => {
    const stamps = await fingerprintTree(join(root, "resources"));

    expect(Object.keys(stamps).length).toBe(3);
    for (const stamp of Object.values(stamps)) {
      expect(stamp).toMatch(/^\d+(\.\d+)?:\d+$/);
    }
  });

  it("returns nothing for a directory that does not exist", async () => {
    expect(await fingerprintTree(join(root, "nope"))).toEqual({});
  });

  it("excludes directories, which have no meaningful size", async () => {
    const stamps = await fingerprintTree(root);
    expect(Object.keys(stamps)).not.toContain(join(root, "resources"));
    expect(Object.keys(stamps)).toContain(join(root, "resources/js/app.ts"));
  });

  it("changes when a file's mtime moves", async () => {
    const before = await fingerprintTree(join(root, "resources"));
    const target = join(root, "resources/js/helper.ts");
    const future = new Date(Date.now() + 10_000);
    await utimes(target, future, future);

    const after = await fingerprintTree(join(root, "resources"));
    expect(after[target]).not.toBe(before[target]);
  });
});

describe("isDevOrchestrated", () => {
  it("recognises the supervised worker by its environment variable", () => {
    expect(isDevOrchestrated({ ZT_DEV: "1" }, ["bun", "app.ts", "serve"])).toBe(true);
  });

  it("recognises the orchestrator from argv, since providers boot before flags parse", () => {
    expect(isDevOrchestrated({}, ["bun", "app.ts", "serve", "--dev"])).toBe(true);
  });

  it("leaves a plain serve to build for itself", () => {
    expect(isDevOrchestrated({}, ["bun", "app.ts", "serve"])).toBe(false);
    expect(isDevOrchestrated({}, ["bun", "app.ts", "serve", "--port", "3000"])).toBe(false);
  });

  it("does not mistake other commands for dev mode", () => {
    expect(isDevOrchestrated({}, ["bun", "app.ts", "queue:work"])).toBe(false);
    expect(isDevOrchestrated({}, ["bun", "app.ts", "build", "--dev"])).toBe(false);
    expect(isDevOrchestrated({}, ["bun", "test"])).toBe(false);
  });
});
