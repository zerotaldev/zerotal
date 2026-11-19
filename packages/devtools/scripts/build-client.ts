#!/usr/bin/env bun
/**
 * Build the inspector's browser bundles into `dist/`, which is what the published
 * package serves.
 *
 * Runs as `prepack`, so every tarball carries a fresh build however it was packed.
 * Run it directly (`bun run build:client`) before `bun zt compile`-ing an app
 * against a checkout of this repository. The bundles are built by the same function
 * a checkout uses at boot (`src/clientAssets.ts`). Output goes to stderr only: the
 * release script reads the tarball's name from the last line `bun pm pack` writes
 * to stdout.
 */
import { join } from "node:path";
import { writeBrowserBundles } from "../../../scripts/browser-bundles.ts";
import { _buildDevtoolsBundle, _DEVTOOLS_BUNDLE_NAMES } from "../src/clientAssets.ts";

const bundles: Record<string, string> = {};
for (const name of _DEVTOOLS_BUNDLE_NAMES) {
  const built = await _buildDevtoolsBundle(name);
  if (!built.ok) {
    console.error(`@zerotal/devtools: the ${name} bundle did not build:`, ...built.logs);
    process.exit(1);
  }
  bundles[name] = built.code;
}

const written = writeBrowserBundles(join(import.meta.dir, "..", "dist"), bundles);
console.error(`@zerotal/devtools: built dist/${written.join(", dist/")}`);
