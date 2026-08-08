/**
 * The framework version this package reports.
 *
 * Read rather than written down. Two hardcoded `"1.0.4"` strings lived in
 * `sources/live.ts` and `sources/system.ts`, and a hardcoded version is only ever
 * correct until the next release: after 1.0.0 shipped, three separate literals across
 * the monorepo still said `1.1.0`, each failing silently — a monitored app cheerfully
 * reported a version that had never been published.
 *
 * The monorepo publishes in lockstep, so this package's own manifest carries the
 * framework version, and it ships inside the tarball — which the repository root does
 * not. The release script verifies the root version against the tag, so this follows
 * the thing that is actually checked at publish time.
 */
import { readFileSync } from "node:fs";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

/** Full version, e.g. `1.1.0`. */
export const ZEROTAL_VERSION: string = pkg.version;

/** Display form used by the system panel, e.g. `v1.1.0`. */
export const ZEROTAL_VERSION_TAG = `v${pkg.version}`;
