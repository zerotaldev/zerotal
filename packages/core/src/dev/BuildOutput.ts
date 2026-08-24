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

/** What `Bun.build()` reports for one emitted file. */
interface BuildArtifact {
  path: string;
  /** `"entry-point"` on the files the build was asked for; absent on older shapes. */
  kind?: string;
}

/** One directory's record: which build wrote which files. */
type Manifest = Record<string, string[]>;

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
  outputs: readonly BuildArtifact[],
): Promise<string[]> {
  const root = resolve(outdir);
  const current = new Set(outputs.map((output) => _relative(root, output.path)));

  // Whose output this is. Nothing stops two builds sharing a directory —
  // `inertia:build` and `assets:build` both default near `public/`, and the
  // default release pipeline runs them one after the other — and with a single
  // list per directory each one read the *other's* files as its own previous
  // build and deleted them. The release ended with whichever ran last, and no
  // error anywhere: `assets:build` removed the Inertia entry point, then
  // `inertia:build` removed the other bundle.
  const key = _buildKey(root, outputs);
  const manifest = await _readManifest(root);
  const mine = new Set(manifest[key] ?? []);
  const theirs = new Set(
    Object.entries(manifest)
      .filter(([owner]) => owner !== key)
      .flatMap(([, files]) => files),
  );

  const stale = new Set<string>();
  for (const path of mine) {
    if (!current.has(path)) stale.add(path);
  }

  // Chunks are swept by name as well as by manifest, so a directory that has
  // been accumulating them since before any manifest existed still gets cleaned
  // on the next build. Only the unclaimed ones: a chunk another build has
  // recorded is that build's to remove.
  for (const path of await _listEntries(root)) {
    if (current.has(path) || theirs.has(path)) continue;
    if (CHUNK_NAME.test(path.split("/").at(-1) ?? "")) stale.add(path);
  }

  const removed = await _unlinkAll(root, stale);
  await _writeManifest(root, { ...manifest, [key]: [...current].sort() });
  return removed;
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

/**
 * Which build these outputs belong to, named by its entry points.
 *
 * Stable across rebuilds of the same build — the entry keeps its name while the
 * chunks around it are rehashed — and different between two builds sharing a
 * directory, which is the whole point of having it.
 */
function _buildKey(root: string, outputs: readonly BuildArtifact[]): string {
  const entries = outputs
    .filter((output) => output.kind === "entry-point")
    .map((output) => _relative(root, output.path))
    .sort();
  // No entry point reported: an older Bun, or a build of nothing. One shared key
  // is what this did before, and is no worse than it was.
  return entries.join("|") || "default";
}

/** What previous builds recorded, or nothing on a first run. */
async function _readManifest(root: string): Promise<Manifest> {
  try {
    const contents = (await Bun.file(_manifestPath(root)).json()) as unknown;

    // Written before this file recorded ownership: one flat list, which belonged
    // to whichever build ran last. Kept under a key no build claims, so those
    // files stay eligible for the build that recognises them and are never
    // treated as another build's property.
    if (Array.isArray(contents)) {
      return { default: contents.filter((entry): entry is string => typeof entry === "string") };
    }
    if (!contents || typeof contents !== "object") return {};

    const manifest: Manifest = {};
    for (const [key, files] of Object.entries(contents as Record<string, unknown>)) {
      if (!Array.isArray(files)) continue;
      manifest[key] = files.filter((entry): entry is string => typeof entry === "string");
    }
    return manifest;
  } catch {
    return {};
  }
}

async function _writeManifest(root: string, manifest: Manifest): Promise<void> {
  const path = _manifestPath(root);
  try {
    await mkdir(join(process.cwd(), MANIFEST_DIR), { recursive: true });
    await writeFile(path, JSON.stringify(manifest, null, 2));
  } catch {
    // A manifest that cannot be written costs precision on the next prune, not
    // correctness: chunks are still swept by name.
  }
}

/** Delete each path, reporting what actually went. */
async function _unlinkAll(root: string, paths: Iterable<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const path of paths) {
    try {
      await unlink(join(root, path));
      removed.push(path);
    } catch {
      // Already gone, or held open by another process — either way the next
      // build tries again, and a file we could not delete is not worth failing
      // an otherwise good build over.
    }
  }
  return removed.sort();
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

/**
 * Remove everything in `outdir` that this build did not write.
 *
 * The difference from {@link pruneBuildOutput} is what it trusts. Pruning
 * removes only what it recognises: a file the manifest recorded, or one named
 * the way `Bun.build()` names a code-split chunk. That covers what this
 * framework's own builds emit, with or without a manifest — the name rule alone
 * holds a directory steady across releases on a machine that has never seen it
 * before. What it cannot recognise is output some other naming produced: an app
 * that sets its own `naming`, or writes a second bundle into the same directory
 * by other means.
 *
 * This needs no recognition — whatever is not in `outputs` goes. It refuses the
 * two directories where that is certainly wrong: the project root, and `public/`,
 * which holds the app's images and favicon beside its bundles. Point it at a
 * dedicated directory, or prune instead.
 *
 * Neither of these helps a directory nothing runs in. A release unpacked over the
 * top of the previous one — `tar -xzf`, `rsync` without `--delete` — merges into
 * it, and no build happens on that machine to clean anything: the old bundles
 * stay, publicly fetchable at their content-hashed URLs. That one is fixed by
 * replacing the directory on release, not here.
 *
 * @param outdir  Absolute path the build wrote to.
 * @param outputs The build's artifacts (`Bun.build()`'s `outputs`).
 * @returns Paths removed, relative to `outdir`.
 * @throws When `outdir` is the project root or its `public/` directory.
 *
 * @internal
 */
export async function cleanBuildOutput(
  outdir: string,
  outputs: readonly BuildArtifact[],
): Promise<string[]> {
  const root = resolve(outdir);
  const cwd = resolve(process.cwd());

  if (root === cwd || root === join(cwd, "public")) {
    throw new Error(
      `Refusing to clean ${_relative(cwd, root) || "."} — it holds more than this build's output, ` +
        `and everything not rebuilt would be deleted. Point the build at a directory of its own ` +
        `(public/assets, say), or drop --clean and let the prune handle chunks.`,
    );
  }

  const current = new Set(outputs.map((output) => _relative(root, output.path)));

  // Directories are left behind: emptied they cost nothing, and removing them
  // races a concurrent read.
  const doomed = (await _listEntries(root)).filter((path) => !current.has(path));
  const removed = await _unlinkAll(root, doomed);

  // This directory now holds one build's output and nothing else, so the record
  // says exactly that — including dropping any other build that used to claim
  // files here, whose files this has just deleted. Sharing a directory with
  // `--clean` is the one thing it does not support, and the record should not
  // pretend otherwise.
  await _writeManifest(root, { [_buildKey(root, outputs)]: [...current].sort() });
  return removed;
}
