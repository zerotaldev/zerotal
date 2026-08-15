/**
 * Noticing that this scaffolder is not the current one.
 *
 * `bun create zerotal` can serve a copy cached from a previous run rather than
 * fetching the published scaffolder, and a stale scaffolder is worse than an old
 * one: it stamps the dependency ranges *it* was built with, so a new project is
 * created against versions that were current months ago while the install log
 * shows today's framework resolving inside those ranges. Everything looks right
 * and the wrong adapter is installed.
 *
 * That happened with a cached 1.5.0, which pinned an Inertia major the DevTools
 * extension cannot read. Nothing said so, because nothing was looking.
 *
 * @module
 */

/** Where the published version is read from. */
export const REGISTRY_LATEST_URL = "https://registry.npmjs.org/create-zerotal/latest";

/** How long to wait before scaffolding without an answer. */
export const REGISTRY_TIMEOUT_MS = 2_000;

/**
 * Compare two dot-separated versions numerically.
 *
 * Pre-release suffixes are ignored — `1.6.3-rc.1` compares as `1.6.3` — because
 * the only decision this drives is whether to suggest re-running, and suggesting
 * it once too often is cheaper than reimplementing SemVer here.
 *
 * @returns Negative when `a` is older, positive when newer, `0` when equal.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The published version, when it is newer than the one running.
 *
 * @param current - This scaffolder's own version.
 * @param options - Seams for tests, and for pointing at a private registry.
 * @returns The newer version, or `null` — including whenever the check cannot be
 *   made. An offline machine, a firewalled registry and a slow network all mean
 *   "no answer", and no answer must never stop someone creating an app.
 *
 * @example
 * const newer = await newerScaffolderVersion(ZT_VERSION);
 * if (newer) warn(`A newer scaffolder exists (${newer}).`);
 */
export async function newerScaffolderVersion(
  current: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; url?: string } = {},
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = options.url ?? REGISTRY_LATEST_URL;
  const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;

  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version !== "string" || version === "") return null;
    return compareVersions(version, current) > 0 ? version : null;
  } catch {
    return null;
  }
}
