/**
 * The framework version this site advertises.
 *
 * Read rather than written down. The landing page and the header badge both
 * display it, and while they were two hardcoded strings the site went on
 * announcing "v1.1 preview" after 1.0.1 had shipped to npm — the version line
 * moved and the markup did not. The monorepo releases in lockstep and the
 * release script checks the root version against the tag, so this follows the
 * thing that is actually verified at publish time.
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);

/** Full version, e.g. `1.0.1`. */
export const ZEROTAL_VERSION: string = pkg.version;

/** Marketing-facing `major.minor`, e.g. `1.0` — patch releases are not news. */
export const ZEROTAL_VERSION_SHORT: string = pkg.version.split(".").slice(0, 2).join(".");

/**
 * The commit this process is serving, if it can be determined.
 *
 * A deploy that reports success proves the *command* ran, not that the bytes
 * changed — and for three batches of documentation fixes the site kept serving an
 * older commit while every check I ran looked reasonable, because nothing on the
 * page said which commit it was. This is that missing sentence.
 *
 * `ZT_BUILD_SHA` first, so a build that has no git directory can still be
 * identified; then `git rev-parse`, which is what the deployment actually is — a
 * checkout. `unknown` rather than a throw: a version string is diagnostics, and a
 * site should not fail to boot because it cannot introspect itself.
 */
function resolveBuildSha(): string {
  const fromEnv = Bun.env["ZT_BUILD_SHA"];
  if (fromEnv) return fromEnv.trim().slice(0, 40);

  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      // `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
      // `/C:/…`, which is not a directory any process can be spawned in.
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdout: "pipe",
      stderr: "ignore",
    });
    const sha = new TextDecoder().decode(proc.stdout).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : "unknown";
  } catch {
    return "unknown";
  }
}

/** Full commit SHA of the running build, or `"unknown"`. */
export const BUILD_SHA: string = resolveBuildSha();

/** The first seven characters, which is what a person compares against `git log`. */
export const BUILD_SHA_SHORT: string = BUILD_SHA.slice(0, 7);

/** When this process started, so a stale service is visible as well as a stale checkout. */
export const BOOTED_AT: string = new Date().toISOString();
