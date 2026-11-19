/**
 * Which credential `npm publish` used, read from npm's own log.
 *
 * Releases are moving from an npm token, which expires, to trusted publishing,
 * where npm trades the workflow's OIDC identity for a short-lived token scoped to
 * one package. The two run side by side while packages are linked on npmjs.com
 * one at a time: npm tries OIDC first and, when the exchange fails (no trusted
 * publisher configured for that package, npm too old, no `id-token` permission),
 * keeps whatever token `NODE_AUTH_TOKEN` supplied. That fallback is silent, so a
 * release that "worked" says nothing about whether the token can be deleted yet.
 * The publisher reports the path for every package, and the token goes only when
 * a release shows every one of them on trusted publishing.
 *
 * npm states the outcome only at `verbose` level, under the `oidc` title, so the
 * publisher runs it with `--loglevel verbose` and passes the output through here.
 * Nothing here reads or prints a credential: the lines kept are npm's own
 * messages, and every other verbose line is dropped.
 *
 * @module
 */

/** The first npm CLI with trusted publishing. */
export const TRUSTED_PUBLISHING_NPM = "11.5.1";

/** How one `npm publish` authenticated. */
export type PublishAuth =
  { readonly kind: "trusted-publishing" } | { readonly kind: "token"; readonly reason: string };

/** What one publish printed, split into what to show and how it authenticated. */
export interface PublishLog {
  /** npm's normal output (notices, warnings, errors), with the verbose detail removed. */
  readonly shown: string[];
  readonly auth: PublishAuth;
}

/** The environment the publisher runs in, as far as authentication goes. */
export interface AuthEnvironment {
  /** `npm --version`, or `undefined` when npm is not on PATH. */
  readonly npmVersion: string | undefined;
  /** Whether `NODE_AUTH_TOKEN` holds anything. Its value is never read past that. */
  readonly hasToken: boolean;
  /** Whether GitHub Actions offered an OIDC token (the job has `id-token: write`). */
  readonly hasIdToken: boolean;
}

// eslint-disable-next-line no-control-regex -- ANSI colour codes are control characters by definition.
const ANSI = /\x1b\[[0-9;]*m/g;
const DETAIL = /^npm (?:verbose|info|http|timing|silly) /;
const OIDC = /^npm verbose oidc (.*)$/;

/** Whether this npm can publish with trusted publishing. */
export function supportsTrustedPublishing(npmVersion: string): boolean {
  return Bun.semver.order(npmVersion, TRUSTED_PUBLISHING_NPM) >= 0;
}

/**
 * Read the stderr of `npm publish --loglevel verbose`.
 *
 * npm logs `Successfully retrieved and set token` when the OIDC exchange
 * worked, and a `Failed …` line naming the reason when it did not. No `oidc`
 * line at all means npm never tried: it is older than 11.5.1, or the job had no
 * OIDC token to offer.
 */
export function readPublishLog(stderr: string): PublishLog {
  const shown: string[] = [];
  let exchanged = false;
  let failure: string | undefined;

  for (const raw of stderr.split(/\r?\n/)) {
    const line = raw.replace(ANSI, "");
    const oidc = OIDC.exec(line);
    if (oidc) {
      const message = oidc[1]!.trim();
      if (message.startsWith("Successfully retrieved")) exchanged = true;
      // Provenance is set up after the exchange and fails on its own terms; the
      // exchange it follows still stands.
      else if (/^Fail/.test(message) && !message.includes("provenance")) failure ??= message;
      continue;
    }
    if (DETAIL.test(line)) continue;
    if (line.trim() !== "") shown.push(raw);
  }

  if (exchanged) return { shown, auth: { kind: "trusted-publishing" } };
  return {
    shown,
    auth: { kind: "token", reason: failure ?? "npm did not attempt an OIDC exchange" },
  };
}

/** One line saying which credentials this run can publish with. */
export function describeAuthEnvironment(env: AuthEnvironment): string {
  const token = env.hasToken ? "NODE_AUTH_TOKEN is set" : "NODE_AUTH_TOKEN is not set";
  if (env.npmVersion === undefined) return `npm not found; ${token}`;
  if (!supportsTrustedPublishing(env.npmVersion)) {
    return `npm ${env.npmVersion} predates trusted publishing (${TRUSTED_PUBLISHING_NPM}); ${token}`;
  }
  const oidc = env.hasIdToken
    ? "trusted publishing is available where a package is linked"
    : "no OIDC token (the job needs id-token: write)";
  return `npm ${env.npmVersion}: ${oidc}; ${token}`;
}

/** Whether this run has any credential at all, so it fails before the first package rather than on it. */
export function canAuthenticate(env: AuthEnvironment): boolean {
  if (env.hasToken) return true;
  return (
    env.npmVersion !== undefined && supportsTrustedPublishing(env.npmVersion) && env.hasIdToken
  );
}
