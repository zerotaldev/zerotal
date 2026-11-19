#!/usr/bin/env bun
/**
 * Build Flow's browser bundles into `dist/`, which is what the published package serves.
 *
 * Runs as `prepack`, so every tarball carries a fresh build however it was packed:
 * the release script's `bun pm pack`, a `bun pm pack` by hand, or `npm pack`. Run
 * it directly (`bun run build:client`) before `bun zt compile`-ing an app against a
 * checkout of this repository, whose `dist/` is otherwise empty.
 *
 * The bundles are built by the same function a checkout uses at boot
 * (`src/clientBundles.ts`), always minified. Nothing but the build log is printed,
 * and only to stderr: the release script reads the tarball's name from the last
 * line `bun pm pack` writes to stdout.
 */
import { join } from "node:path";
import { writeBrowserBundles } from "../../../scripts/browser-bundles.ts";
import { _buildClientBundle, _CLIENT_BUNDLE_NAMES } from "../src/clientBundles.ts";

const bundles: Record<string, string> = {};
for (const name of _CLIENT_BUNDLE_NAMES) {
  const built = await _buildClientBundle(name, true);
  if (!built.ok) {
    console.error(`@zerotal/flow: the ${name} bundle did not build:`, ...built.logs);
    process.exit(1);
  }
  bundles[name] = built.code;
}

const written = writeBrowserBundles(join(import.meta.dir, "..", "dist"), bundles);
console.error(`@zerotal/flow: built dist/${written.join(", dist/")}`);
