/**
 * Cleanup of the files a previous build left in an output directory.
 *
 * Code-splitting names every shared chunk after its content — `chunk-3f9a2c.js`
 * — so each rebuild emits a fresh set and abandons the last one. Nothing
 * overwrites those old names, so an output directory grows without limit across
 * a dev session: hundreds of dead chunks, every one of them registered as a
 * static route at startup and shipped in a production deploy.
 */
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** Bundler-generated code-split chunk, e.g. `chunk-2502z4dn.js` (+ `.map`). */
const CHUNK_NAME = /^chunk-[a-z0-9]+\.js(\.map)?$/i;

/** Where the per-directory record of "what the last build wrote" is kept. */
const MANIFEST_DIR = ".zerotal/build";

/**
 * Delete what an earlier build wrote to `outdir` and this one did not.
 *
 * Two things qualify for removal, and nothing else: a file the previous build
 * recorded as its own output, and a file named the way the bundler names
 * code-split chunks. Everything else in the directory is left alone — an output
 * directory is often `public/`, where a blanket wipe would take the app's
 * images and favicon with it.
 *
 * Call this only after a *successful* build. Pruning after a failed one would
 * delete the working output and leave nothing to serve in its place.
 *
 * @param outdir  Absolute path the build wrote to.
 * @param outputs The build's artifacts (`Bun.build()`'s `outputs`).
 * @returns Paths removed, relative to `outdir`.
 *
 * @example
 * const result = await Bun.build({ entrypoints, outdir, splitting: true });
 * if (result.success) await pruneBuildOutput(outdir, result.outputs);
 *
 * @internal
 */
export async function pruneBuildOutput(
  outdir: string,
  outputs: readonly { path: string }[],
): Promise<string[]> {
  const root = resolve(outdir);
  const current = new Set(outputs.map((output) => _relative(root, output.path)));

  const previous = await _readManifest(root);
  const stale = new Set<string>();

  for (const path of previous) {
    if (!current.has(path)) stale.add(path);
  }

  // Chunks are swept by name as well as by manifest, so a directory that has
  // been accumulating them since before any manifest existed still gets cleaned
  // on the next build.
  for (const path of await _listEntries(root)) {
    if (current.has(path)) continue;
    if (CHUNK_NAME.test(path.split("/").at(-1) ?? "")) stale.add(path);
  }

  const removed: string[] = [];
  for (const path of stale) {
    try {
      await unlink(join(root, path));
      removed.push(path);
    } catch {
      // Already gone, or held open by another process — either way the next
      // build tries again, and a file we could not delete is not worth failing
      // an otherwise good build over.
    }
  }

  await _writeManifest(root, [...current].sort());
  return removed.sort();
}

// ── Private ──────────────────────────────────────────────────────────────────

/** Path relative to `root`, with forward slashes so manifests are portable. */
function _relative(root: string, path: string): string {
  return relative(root, resolve(path)).split("\\").join("/");
}

/**
 * The manifest lives outside `outdir` — writing it inside would put a file the
 * app then serves (and registers a route for) into the public directory.
 */
function _manifestPath(root: string): string {
  const slug = _relative(resolve(process.cwd()), root).replace(/[^a-z0-9]+/gi, "-") || "out";
  // The slug alone can collide (two different roots normalising to the same
  // name); the hash makes each directory's manifest its own.
  const hash = Bun.hash(root).toString(36);
  return join(process.cwd(), MANIFEST_DIR, `${slug}-${hash}.json`);
}

/** What the previous build recorded, or nothing on a first run. */
async function _readManifest(root: string): Promise<string[]> {
  try {
    const contents = (await Bun.file(_manifestPath(root)).json()) as unknown;
    if (!Array.isArray(contents)) return [];
    return contents.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

async function _writeManifest(root: string, files: string[]): Promise<void> {
  const path = _manifestPath(root);
  try {
    await mkdir(join(process.cwd(), MANIFEST_DIR), { recursive: true });
    await writeFile(path, JSON.stringify(files, null, 2));
  } catch {
    // A manifest that cannot be written costs precision on the next prune, not
    // correctness: chunks are still swept by name.
  }
}

/**
 * Every entry under `root`, relative and slash-normalised. Empty if unreadable
 * (a first build has nothing to clean, and neither does a missing directory).
 */
async function _listEntries(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true });
    return entries.map((entry) => entry.split("\\").join("/"));
  } catch {
    return [];
  }
}
