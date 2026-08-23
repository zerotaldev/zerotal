/**
 * Asset-build helpers for dev mode: detecting the app's Tailwind plugin and
 * bundling CSS and JavaScript entry points with Bun's native bundler (falling
 * back to the Tailwind CLI when the plugin is absent).
 */
import type { BunPlugin } from "bun";
import { pruneBuildOutput, cleanBuildOutput } from "./BuildOutput.ts";
import { BuildCache } from "./BuildCache.ts";

/** Outcome of one bundling helper. `skipped` means the cache answered. */
export interface BundleResult {
  success: boolean;
  logs: unknown[];
  /** True when nothing was rebuilt because no input had changed. */
  skipped?: boolean;
}

/**
 * Directories whose contents feed Tailwind's `@source` scan.
 *
 * A stylesheet's inputs are not its imports — utility classes are discovered by
 * reading templates and components, none of which appear in a sourcemap. These
 * are the conventional locations; a missing one contributes nothing.
 */
function _scanRoots(cwd: string): string[] {
  return [`${cwd}/app`, `${cwd}/resources`, `${cwd}/routes`, `${cwd}/config`];
}

/**
 * Detect and load `bun-plugin-tailwind` from the app's own node_modules.
 *
 * Bun ships first-class CSS support and `bun-plugin-tailwind` handles
 * Tailwind v4 natively — no PostCSS or @tailwindcss/postcss needed.
 * Apps only need:
 *
 *   bun add -d bun-plugin-tailwind
 *
 * Packages are resolved from the project CWD (not from @zerotal/core) so the
 * plugin only needs to be in the app's own node_modules.
 *
 * Returns an empty array when `bun-plugin-tailwind` is not installed.
 * The caller falls back to a `bunx @tailwindcss/cli` subprocess.
 */
export async function detectCssPlugins(cwd: string): Promise<BunPlugin[]> {
  try {
    const pluginPath = Bun.resolveSync("bun-plugin-tailwind", cwd);
    const module = (await import(pluginPath)) as { default: BunPlugin };
    return [module.default];
  } catch {
    return [];
  }
}

/**
 * Build a CSS entry point using the Tailwind PostCSS plugin.
 *
 * Used by PulseProvider and ViewProvider to register a dev build hook
 * for CSS-only apps (no JS bundle required).
 *
 * @param input   Absolute path to the CSS source (e.g. `${cwd}/resources/css/app.css`)
 * @param outdir  Absolute path to the output directory (e.g. `${cwd}/public/css`)
 * @param minify  Whether to minify the output (true in production)
 */
export async function buildCssBundle(
  input: string,
  outdir: string,
  minify = false,
  loader?: Record<string, string>,
): Promise<BundleResult> {
  const cwd = process.cwd();
  const plugins = await detectCssPlugins(cwd);

  // The whole source tree is this bundle's input set, because that is what
  // Tailwind reads. Broad, but a stat sweep is far cheaper than the build.
  const cache = BuildCache.for(
    {
      entrypoints: [input],
      outdir,
      minify,
      loader,
      plugins: plugins.map((plugin) => plugin.name ?? "anonymous"),
      extra: { kind: "css", cli: plugins.length === 0 },
    },
    cwd,
  );

  if (!minify && (await cache.isFresh())) return { success: true, logs: [], skipped: true };

  if (plugins.length > 0) {
    // bun-plugin-tailwind is available — use Bun's native CSS bundler
    const result = await Bun.build({
      entrypoints: [input],
      outdir,
      target: "browser",
      minify,
      plugins,
      ...(loader
        ? { loader: loader as NonNullable<Parameters<typeof Bun.build>[0]["loader"]> }
        : {}),
    });

    if (result.success) await cache.record(result.outputs, { scanRoots: _scanRoots(cwd) });
    return { success: result.success, logs: result.logs as unknown[] };
  }

  // Fallback: run the Tailwind CLI as a subprocess
  // Works with just `tailwindcss` installed (no postcss needed).
  try {
    const outputFile = `${outdir}/${_basename(input)}`;
    const commandArgs = [
      "bun",
      "x",
      "--bun",
      "@tailwindcss/cli",
      "-i",
      input,
      "-o",
      outputFile,
      ...(minify ? ["--minify"] : []),
    ];

    const subprocess = Bun.spawn(commandArgs, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
    ]);

    if (exitCode === 0) {
      // The CLI emits no sourcemap and returns no artifact list, so the one
      // output is named rather than discovered.
      await cache.record([{ path: outputFile }], { scanRoots: _scanRoots(cwd) });
    }

    return {
      success: exitCode === 0,
      logs: exitCode !== 0 ? [stderr] : [],
    };
  } catch (error) {
    return { success: false, logs: [error] };
  }
}

/**
 * Bundle a JavaScript entry point for the browser using Bun's native bundler.
 *
 * Used by FlowProvider to bundle `resources/js/app.js` → `public/js/app.js`.
 * Workspace package imports (e.g. `@zerotal/devtools/client`) are resolved
 * from the app's own node_modules and tree-shaken into the output.
 *
 * @param input   Absolute path to the JS/TS entry (e.g. `${cwd}/resources/js/app.js`)
 * @param outdir  Absolute path to the output directory (e.g. `${cwd}/public/js`)
 * @param minify  Whether to minify the output (true in production)
 */
export async function buildJsBundle(
  input: string,
  outdir: string,
  minify = false,
): Promise<BundleResult> {
  const cwd = process.cwd();
  const cache = BuildCache.for(
    { entrypoints: [input], outdir, minify, extra: { kind: "js" } },
    cwd,
  );

  if (!minify && (await cache.isFresh())) return { success: true, logs: [], skipped: true };

  try {
    const result = await Bun.build({
      entrypoints: [input],
      outdir,
      target: "browser",
      format: "esm",
      minify,
      // Not only for debugging: the map's `sources` are how the cache learns
      // which files this bundle actually pulled in.
      ...(minify ? {} : { sourcemap: "external" as const }),
    });

    // No scan roots — a JS bundle's inputs are exactly its module graph.
    if (result.success) await cache.record(result.outputs);
    return { success: result.success, logs: result.logs as unknown[] };
  } catch (error) {
    return { success: false, logs: [error] };
  }
}

function _basename(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

/** The resolved `app.assets` config block (see {@link AppAssetsConfig}). */
export interface AssetBuildConfig {
  entrypoint: string | string[];
  outDir: string;
  prefix: string;
  minify: boolean;
  /** Per-extension loader overrides (e.g. `{ ".woff2": "file" }`). See AppAssetsConfig. */
  loader?: Record<string, string>;
  /**
   * Delete everything in `outDir` this build did not write, rather than only what
   * the last build on this machine recorded. See {@link cleanBuildOutput} — it
   * refuses a directory that holds more than build output.
   */
  clean?: boolean;
}

/**
 * Bundle the app's configured asset entrypoint(s) with Bun's native bundler.
 *
 * Entry paths and `outDir` are resolved relative to `cwd`. A JS/TS entry that
 * imports CSS emits a sibling stylesheet; Tailwind v4 is handled automatically
 * when `bun-plugin-tailwind` is installed in the app. Called by `serve` (once)
 * and by the dev build hook (on change) — see {@link buildConfiguredAssets}.
 *
 * Mirrors the Inertia build pipeline: `splitting` emits shared chunks from
 * dynamic imports (per-page code-splitting), and sourcemaps are emitted in dev
 * (external) but omitted in production. Entry filenames stay stable across
 * builds — cache-busting is handled at reference time by `asset()` appending
 * `?v=` in dev, not by hashed output names — while split chunks are named after
 * their content and so change on every rebuild. The chunks the build replaces
 * are swept up afterwards; see {@link pruneBuildOutput}.
 */
export async function buildConfiguredAssets(
  assets: AssetBuildConfig,
  cwd: string,
): Promise<BundleResult> {
  const entries = Array.isArray(assets.entrypoint) ? assets.entrypoint : [assets.entrypoint];
  const entrypoints = entries.map((entry) => `${cwd}/${entry}`);
  const outdir = `${cwd}/${assets.outDir}`;

  try {
    const plugins = await detectCssPlugins(cwd);

    const cache = BuildCache.for(
      {
        entrypoints,
        outdir,
        minify: assets.minify,
        loader: assets.loader,
        plugins: plugins.map((plugin) => plugin.name ?? "anonymous"),
        extra: { kind: "configured" },
      },
      cwd,
    );

    // Never in a minified (production) build: the cost of a wrong skip there is
    // shipping stale assets, and the build runs once rather than on every save.
    if (!assets.minify && (await cache.isFresh())) {
      return { success: true, logs: [], skipped: true };
    }

    const result = await Bun.build({
      entrypoints,
      outdir,
      target: "browser",
      format: "esm",
      // Per-page chunks from dynamic imports — same as `inertia:build`.
      splitting: true,
      // Sourcemaps for dev debugging; none in production (minified) builds.
      sourcemap: assets.minify ? "none" : "external",
      minify: assets.minify,
      plugins,
      // `app.assets.loader` — e.g. `{ ".woff2": "file" }` to stop fonts being inlined
      // as data URIs into the render-blocking stylesheet.
      ...(assets.loader
        ? { loader: assets.loader as NonNullable<Parameters<typeof Bun.build>[0]["loader"]> }
        : {}),
    });

    // Prune only after a build that actually ran. A skipped build returns no
    // outputs, and pruning against an empty set would delete the entire
    // previous build — which is why the cache check returns early above rather
    // than falling through to here.
    if (result.success) {
      if (assets.clean) await cleanBuildOutput(outdir, result.outputs);
      else await pruneBuildOutput(outdir, result.outputs);
      await cache.record(result.outputs, { scanRoots: _scanRoots(cwd) });
    }
    return { success: result.success, logs: result.logs as unknown[] };
  } catch (error) {
    return { success: false, logs: [error] };
  }
}
