#!/usr/bin/env bun
/**
 * Lockstep publisher for the @zerotal/* workspace.
 *
 * Every public package shares one version line, so a release is all-or-nothing:
 * this script verifies the lockstep invariant (every public package at the same
 * version, matching the tag being released), packs each package with `bun pm pack`
 * — which rewrites `workspace:*` dependencies to the real version — and hands the
 * tarballs to `npm publish --provenance`, so consumers can verify every tarball
 * was built from this repository's CI.
 *
 * Packages are published in dependency order (core before the packages that
 * depend on it), so a half-failed release never leaves a package on the registry
 * whose dependencies do not resolve.
 *
 *   bun run scripts/publish-packages.ts --dry-run          # verify + pack only
 *   bun run scripts/publish-packages.ts --tag v1.1.0       # verify tag matches, pack, publish
 */
import { readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const ROOT = resolve(".");
const OUT_DIR = join(ROOT, ".release-tarballs");

const dryRun = process.argv.includes("--dry-run");
const tagFlag = process.argv.indexOf("--tag");
const tag = tagFlag !== -1 ? process.argv[tagFlag + 1] : undefined;

function fail(message: string): never {
  console.error(`\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

/**
 * Assert a packed tarball's own `@zerotal/*` dependencies are the version being
 * released.
 *
 * `bun pm pack` resolves `workspace:*` from **bun.lock**, not from the manifests
 * on disk. Bump the versions without re-running `bun install` and it will happily
 * stamp the previous release's numbers into the new tarballs — which is how
 * 1.0.1 shipped as a 1.0.1 shell around 1.0.0 internals. Installing it produced
 * two copies of packages that augment global types, and the duplicate
 * declarations broke `tsc` in the consuming app.
 *
 * Nothing else catches it: every gate passes, the tag matches, and the failure
 * only appears in someone else's `node_modules`.
 */
function assertInternalDepsMatch(name: string, tarball: string, version: string): void {
  // Basename with cwd, never the absolute path: on Windows `tar` reads a leading
  // `C:` as a remote host and fails with "Cannot connect to C".
  const read = Bun.spawnSync(
    ["tar", "-xzOf", tarball.split(/[\\/]/).at(-1)!, "package/package.json"],
    {
      cwd: OUT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (read.exitCode !== 0) fail(`could not read back the packed manifest for ${name}`);

  // `dependencies` only. Peer ranges are hand-written and deliberately wider
  // than one release (`^1.0.0` covers 1.0.1 by design); it is the workspace
  // rewrite that must land on the exact version being published.
  const packed = JSON.parse(read.stdout.toString()) as PackageManifest;
  const wrong = Object.entries(packed.dependencies ?? {}).filter(
    ([dep, range]) =>
      (dep === "zerotal" || dep.startsWith("@zerotal/")) && String(range) !== version,
  );

  if (wrong.length > 0) {
    fail(
      `${name} packed with stale internal dependencies at ${version}:\n` +
        wrong.map(([d, r]) => `    ${d}@${r}`).join("\n") +
        `\n  Run \`bun install\` so bun.lock matches the bumped manifests, then re-pack.`,
    );
  }
}

/** Every publishable package under packages/, keyed by npm name. */
function publicPackages(): Map<string, { dir: string; manifest: PackageManifest }> {
  const out = new Map<string, { dir: string; manifest: PackageManifest }>();
  for (const entry of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(ROOT, "packages", entry.name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageManifest;
    if (manifest.private === true) continue;
    out.set(manifest.name, { dir, manifest });
  }
  return out;
}

/** Dependency-order the packages: a package publishes only after its workspace deps. */
function publishOrder(packages: Map<string, { dir: string; manifest: PackageManifest }>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(name: string): void {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") fail(`dependency cycle involving ${name}`);
    state.set(name, "visiting");
    const entry = packages.get(name);
    if (entry) {
      const deps = { ...entry.manifest.dependencies, ...entry.manifest.peerDependencies };
      for (const dep of Object.keys(deps)) {
        if (packages.has(dep)) visit(dep);
      }
      order.push(name);
    }
    state.set(name, "done");
  }

  for (const name of packages.keys()) visit(name);
  return order;
}

const packages = publicPackages();
if (packages.size === 0) fail("no publishable packages found under packages/");

// ── The lockstep invariant ────────────────────────────────────────────────────
const versions = new Set([...packages.values()].map((p) => p.manifest.version));
if (versions.size !== 1) {
  fail(`packages disagree on version: ${[...versions].join(", ")} — the line publishes lockstep`);
}
const version = [...versions][0]!;

if (tag !== undefined && tag !== `v${version}`) {
  fail(`tag ${tag} does not match the package version ${version} (expected v${version})`);
}

const order = publishOrder(packages);
console.log(
  `Releasing ${packages.size} package(s) at ${version}${dryRun ? " (dry run — no publish)" : ""}`,
);

// ── Pack, then publish ────────────────────────────────────────────────────────
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const name of order) {
  const { dir } = packages.get(name)!;

  const pack = Bun.spawnSync(["bun", "pm", "pack", "--destination", OUT_DIR, "--quiet"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (pack.exitCode !== 0) {
    fail(`bun pm pack failed for ${name}:\n${pack.stderr.toString()}`);
  }
  const tarball = pack.stdout.toString().trim().split("\n").at(-1)!.trim();
  assertInternalDepsMatch(name, tarball, version);
  console.log(`  packed  ${name} → ${tarball}`);

  if (dryRun) continue;

  const publish = Bun.spawnSync(["npm", "publish", tarball, "--provenance", "--access", "public"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (publish.exitCode !== 0) {
    fail(
      `npm publish failed for ${name} — packages published before it are live; ` +
        `fix the cause and re-run (npm rejects duplicate versions, so re-publishing is safe)`,
    );
  }
  console.log(`  \x1b[32mpublished\x1b[0m ${name}@${version}`);
}

console.log(
  dryRun
    ? `\x1b[32m✓\x1b[0m dry run complete: ${packages.size} tarball(s) in ${OUT_DIR}`
    : `\x1b[32m✓\x1b[0m released ${packages.size} package(s) at ${version}`,
);
