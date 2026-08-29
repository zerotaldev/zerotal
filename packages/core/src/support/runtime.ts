/**
 * One project, one Bun.
 *
 * `engines.bun` is a floor, and nothing enforces it. A project can therefore end
 * up with two runtimes in play at once — the shell's `bun` and the one sitting in
 * `node_modules/bun`, put there by a transitive peer dependency nobody declared —
 * and split its work between them: the server served by one, the suite run by the
 * other. Nothing announces that. The suite stays green, and it is green about a
 * runtime the app is not served by.
 *
 * What makes it expensive is that the difference is real but narrow. The SQLite
 * bindings, `node:` compatibility and the test runner itself all differ between
 * releases, so a handful of assertions happen to be runtime-sensitive and the rest
 * are not. When two of them fail you go looking for a bug in the code they touch,
 * because nothing in the failure says "different binary". And a suite that passes
 * is not evidence: it only means no test happened to stand on a difference.
 *
 * This module is the check. It is not a pin — the version to agree on is whichever
 * one the project installed, so `bun update bun` moves it and nothing here needs
 * editing. What it enforces is that there is only one.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Set to `1`/`true` to downgrade a runtime disagreement from a refusal to a warning. */
export const RUNTIME_MISMATCH_ESCAPE = "ZT_ALLOW_RUNTIME_MISMATCH";

/** A running runtime and the installed one it disagrees with. */
export interface RuntimeMismatch {
  /** `Bun.version` — the binary this process is executing under. */
  running: string;
  /** The version in `node_modules/bun/package.json`. */
  installed: string;
  /** Absolute path of the manifest `installed` was read from. */
  manifest: string;
}

/**
 * The Bun version a project has installed, by walking up from `cwd` looking for
 * `node_modules/bun/package.json`.
 *
 * Walking rather than reading one fixed path because hoisting decides where the
 * package lands: in a workspace it is at the repo root, not beside the app.
 *
 * @param cwd - Directory to start from.
 * @returns `{ version, manifest }`, or `null` when the project does not install
 *   Bun as a package — which is the common case and not a finding.
 */
export function installedBunVersion(cwd: string): { version: string; manifest: string } | null {
  let dir = cwd;
  // Bounded by the filesystem root: dirname("/") === "/" and dirname("C:\\") === "C:\\".
  for (;;) {
    const manifest = join(dir, "node_modules", "bun", "package.json");
    try {
      const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
      if (version) return { version, manifest };
    } catch {
      // Not here — keep climbing.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Compare the running runtime against the installed one.
 *
 * The comparison is exact. A patch difference is still two binaries, and the
 * failures this guards against do not respect semver — a change to the SQLite
 * bindings is a patch release to Bun and a behaviour change to an app that stores
 * money in SQLite. "Close enough" is the belief that cost the weeks.
 *
 * @param cwd - Project root to look under. Defaults to the working directory.
 * @returns The mismatch, or `null` when the versions agree or nothing is installed
 *   to disagree with.
 */
export function runtimeMismatch(cwd: string = process.cwd()): RuntimeMismatch | null {
  const running = typeof Bun === "undefined" ? "" : Bun.version;
  if (!running) return null;
  const installed = installedBunVersion(cwd);
  if (!installed) return null;
  if (installed.version === running) return null;
  return { running, installed: installed.version, manifest: installed.manifest };
}

/**
 * The message shown for a mismatch — the two versions, where the second came from,
 * and the two ways out.
 *
 * @param mismatch - The disagreement to describe.
 */
export function runtimeMismatchMessage(mismatch: RuntimeMismatch): string {
  return (
    `Two Bun runtimes are in play. This process is Bun ${mismatch.running}, but the ` +
    `project installs Bun ${mismatch.installed} (${mismatch.manifest}).\n\n` +
    `  Whichever one is not running this command is still running something else — ` +
    `the server, the suite, a deploy step — and a test that passes under one is not ` +
    `evidence about the other.\n\n` +
    `  Fix it by picking one:\n` +
    `    bun update bun          # move the installed one to match your shell\n` +
    `    node_modules/.bin/bun   # or run everything through the installed one\n\n` +
    `  To boot anyway, set ${RUNTIME_MISMATCH_ESCAPE}=1 — it downgrades this to a warning.`
  );
}

/**
 * Whether the escape hatch is set. Deliberately an env var and not a config key:
 * the situation it covers is a project mid-upgrade, where the thing you want is to
 * get one command through, not to write the exception down.
 */
export function runtimeMismatchAllowed(): boolean {
  const raw = (globalThis as { Bun?: { env: Record<string, string | undefined> } }).Bun?.env[
    RUNTIME_MISMATCH_ESCAPE
  ];
  return raw === "1" || raw === "true";
}

/**
 * The Bun binary to spawn a child process with.
 *
 * `process.execPath` rather than `"bun"`, because `"bun"` is resolved by the OS
 * against `PATH` and the parent process was not necessarily started from `PATH`.
 * A command that exists to run *this app's* tests, spawning whichever binary the
 * shell happens to offer, is how the suite ends up on a different runtime from the
 * server — and it is invisible, because the child prints a version nobody reads.
 *
 * @returns An absolute path to the running binary, or `"bun"` when there is none to
 *   read (a compiled binary, an unusual embed) and PATH is all that is left.
 */
export function bunBinary(): string {
  const path = process.execPath;
  return path && path.length > 0 ? path : "bun";
}

/** A running runtime and the floor the project says it needs. */
export interface RuntimeFloor {
  /** `Bun.version` — the binary this process is executing under. */
  running: string;
  /** The `engines.bun` range the project declares. */
  required: string;
  /** Absolute path of the manifest `required` was read from. */
  manifest: string;
}

/**
 * The project's declared Bun floor, by walking up from `cwd` for a `package.json`
 * with an `engines.bun`.
 *
 * Walking rather than reading one fixed path, for the same reason
 * {@link installedBunVersion} walks: in a workspace the app and the manifest that
 * pins the runtime are not always the same directory. The first `engines.bun` found
 * wins — the nearest one is the app's own.
 *
 * @param cwd - Directory to start from.
 * @returns `{ range, manifest }`, or `null` when nothing up the tree declares one.
 */
export function declaredBunFloor(cwd: string): { range: string; manifest: string } | null {
  let dir = cwd;
  // Bounded by the filesystem root: dirname("/") === "/" and dirname("C:\\") === "C:\\".
  for (;;) {
    const manifest = join(dir, "package.json");
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        engines?: { bun?: string };
      };
      const range = parsed.engines?.bun;
      if (range) return { range, manifest };
    } catch {
      // No manifest here, or not one we can read — keep climbing.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether this process is running below the Bun version the project says it needs.
 *
 * `engines.bun` is written by every generated app and enforced by nothing, which is
 * the gap {@link runtimeMismatch} does not cover: that one compares the running
 * runtime against an *installed* one, and most projects do not install Bun as a
 * package, so it has nothing to compare against and correctly says nothing.
 *
 * The failure this catches is narrow and expensive. `Intl` output differs between
 * Bun releases, so a suite with currency or date assertions goes red on a runtime
 * that is otherwise fine, and the failures name the code they touch rather than the
 * binary. The version is the last thing anyone checks.
 *
 * An unparseable range is treated as satisfied. A refusal because we could not read
 * a version range is worse than the mismatch it would have prevented.
 *
 * @param cwd - Project root to look under. Defaults to the working directory.
 * @returns The shortfall, or `null` when the floor is met or none is declared.
 */
export function runtimeBelowFloor(cwd: string = process.cwd()): RuntimeFloor | null {
  const running = typeof Bun === "undefined" ? "" : Bun.version;
  if (!running) return null;
  const declared = declaredBunFloor(cwd);
  if (!declared) return null;
  if (Bun.semver.satisfies(running, declared.range)) return null;
  return { running, required: declared.range, manifest: declared.manifest };
}

/**
 * The message shown when the runtime is below the project's floor.
 *
 * @param floor - The shortfall to describe.
 */
export function runtimeBelowFloorMessage(floor: RuntimeFloor): string {
  return (
    `This process is Bun ${floor.running}, and the project requires ${floor.required} ` +
    `(${floor.manifest}).\n\n` +
    `  The difference between two Bun releases is real and narrow: Intl formatting, the ` +
    `SQLite bindings and node: compatibility all move, so a handful of assertions are ` +
    `runtime-sensitive and the rest are not. When two of them fail you go looking for a bug ` +
    `in the code they touch, because nothing in the failure says "wrong binary".\n\n` +
    `  Fix it by upgrading the runtime, or by lowering engines.bun if this version is ` +
    `genuinely supported:\n` +
    `    bun upgrade\n\n` +
    `  To run anyway, set ${RUNTIME_MISMATCH_ESCAPE}=1 — it downgrades this to a warning.`
  );
}
