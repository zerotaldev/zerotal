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
import { readFileSync } from "node:fs";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);

/** Full version, e.g. `1.0.1`. */
export const ZEROTAL_VERSION: string = pkg.version;

/** Marketing-facing `major.minor`, e.g. `1.0` — patch releases are not news. */
export const ZEROTAL_VERSION_SHORT: string = pkg.version.split(".").slice(0, 2).join(".");
