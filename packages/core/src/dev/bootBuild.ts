/**
 * Whether an asset bundle should be built as part of starting the server.
 *
 * `serve` rebuilds the frontend bundle at boot rather than trusting what was shipped,
 * which is right in development and load-bearing in production for the wrong reason: it
 * makes the server process require write access to its own output directory. A unit
 * hardened the way a unit should be —
 *
 *     ProtectSystem=strict
 *     ReadWritePaths=/opt/app/database /opt/app/storage
 *
 * — then fails at startup with `Read-only file system: writing chunk "./app.css"`, and
 * restart-loops. The logs blame the filesystem rather than the boot-time build that made
 * it a problem, so the fix looks like "grant more write access" when it should be "stop
 * writing at boot".
 *
 * The policy here: in production, build only if the output directory is actually
 * writable. A read-only output directory is a deployment that built its assets ahead of
 * time and locked the tree down, which is the correct shape — so it is honoured with one
 * log line rather than a crash. Everywhere else, and anywhere the directory is writable,
 * behaviour is exactly as before.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { isProdLike } from "../support/env.ts";

/** What to do about a boot-time asset build, and why. */
export interface BootBuildDecision {
  /** Whether to run the build. */
  build: boolean;
  /** Single-line explanation of a skip, worth logging. Absent when building. */
  reason?: string;
}

/**
 * Whether a directory can be written to, creating it if absent.
 *
 * Tested by writing rather than by reading a permission bit: the thing that makes
 * `public/` unwritable in the failure this guards against is `ProtectSystem=strict`, a
 * mount-level restriction that a mode check does not see.
 */
export async function isWritableDir(dir: string): Promise<boolean> {
  const probe = `${dir}/.zerotal-write-probe-${process.pid}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
  } catch {
    return false;
  }
  // Best-effort cleanup: the probe is already proof of writability, and failing to remove
  // it should not turn a writable directory into an unwritable one.
  try {
    await unlink(probe);
  } catch {
    /* empty */
  }
  return true;
}

/**
 * Decide whether to build the given output directories at boot.
 *
 * @param outDirs - Absolute paths the build writes into.
 * @param env - The resolved `app.env` (or `APP_ENV`).
 *
 * @example
 * ```ts
 * const decision = await bootBuildDecision([`${cwd}/public/css`], config('app.env'));
 * if (!decision.build) console.info(decision.reason);
 * else await build();
 * ```
 */
export async function bootBuildDecision(
  outDirs: string[],
  env: string | undefined,
): Promise<BootBuildDecision> {
  // `isProdLike` — so `staging` gets the same treatment. A staging box is hardened
  // like a production one, and used to build at boot regardless of whether its output
  // directory was writable: the one environment where the read-only crash was still
  // reachable.
  if (!isProdLike(env ?? "")) return { build: true };

  const unwritable: string[] = [];
  for (const dir of outDirs) {
    if (!(await isWritableDir(dir))) unwritable.push(dir);
  }
  if (unwritable.length === 0) return { build: true };

  return {
    build: false,
    reason:
      `skipping the boot-time asset build: ${unwritable.join(", ")} is not writable. ` +
      `Serving what was shipped — build assets at deploy time, before the process starts.`,
  };
}
