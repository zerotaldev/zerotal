/**
 * Asset-build helpers for dev mode: detecting the app's Tailwind plugin and
 * bundling CSS and JavaScript entry points with Bun's native bundler (falling
 * back to the Tailwind CLI when the plugin is absent).
 */
import type { BunPlugin } from "bun";
import { pruneBuildOutput } from "./BuildOutput.ts";

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
): Promise<{ success: boolean; logs: unknown[] }> {
  const cwd = process.cwd();
  const plugins = await detectCssPlugins(cwd);

  if (plugins.length > 0) {
    // bun-plugin-tailwind is available — use Bun's native CSS bundler
    return Bun.build({
      entrypoints: [input],
      outdir,
      target: "browser",
      minify,
      plugins,
    });
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
): Promise<{ success: boolean; logs: unknown[] }> {
  try {
    return await Bun.build({
      entrypoints: [input],
      outdir,
      target: "browser",
      format: "esm",
      minify,
    });
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
): Promise<{ success: boolean; logs: unknown[] }> {
  const entries = Array.isArray(assets.entrypoint) ? assets.entrypoint : [assets.entrypoint];
  const entrypoints = entries.map((entry) => `${cwd}/${entry}`);
  const outdir = `${cwd}/${assets.outDir}`;

  try {
    const plugins = await detectCssPlugins(cwd);
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
    });

    if (result.success) await pruneBuildOutput(outdir, result.outputs);
    return result;
  } catch (error) {
    return { success: false, logs: [error] };
  }
}
