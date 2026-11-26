/**
 * The npm dist-tag a release goes out under.
 *
 * `npm publish` moves `latest` to whatever it publishes unless told otherwise. That
 * is right for every release on the newest line and wrong for a security fix on an
 * older one: publishing 1.17.5 after 1.18.0 would point `latest` back at 1.17, and
 * every `bun add zerotal` from then on would install the older line. So a release
 * below the current `latest` goes out under `release-<major>.<minor>` instead, and
 * `latest` stays where it is.
 *
 * The name is not `1.17` because npm refuses a dist-tag that parses as a semver
 * range, which `1.17` does.
 */

/**
 * The dist-tag for `version` when the registry's `latest` is `latest`.
 *
 * `undefined` means npm's default, `latest`: the first release, a release on the
 * newest line, or a registry that could not be read. Reading the registry failing
 * open is deliberate — the newest line is by far the common case, and a backport
 * run is a deliberate act where the log line below says which tag was chosen.
 */
export function distTagFor(version: string, latest: string | undefined): string | undefined {
  if (!latest || !/^\d+\.\d+\.\d+/.test(latest)) return undefined;
  if (Bun.semver.order(version, latest) >= 0) return undefined;
  const [major, minor] = version.split(".");
  return `release-${major}.${minor}`;
}

/** The registry's current `latest` for `name`, or `undefined` when it cannot be read. */
export function registryLatest(name: string, cwd: string): string | undefined {
  const view = Bun.spawnSync(["npm", "view", name, "dist-tags.latest"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (view.exitCode !== 0) return undefined;
  const latest = view.stdout.toString().trim();
  return latest === "" ? undefined : latest;
}
