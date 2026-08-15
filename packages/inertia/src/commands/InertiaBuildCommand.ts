import { Command } from "@zerotal/core";
import { pruneBuildOutput, browserEnvDefines } from "@zerotal/core/dev";
import { generatePageRegistry } from "../PageRegistry.ts";
import { detectCssPlugins } from "../css.ts";
import { detectVuePlugin } from "../vuePlugin.ts";

/**
 * `inertia:build` — regenerate the page registry and bundle the frontend with
 * `Bun.build` (code-split into per-page chunks) into `public/assets/`. Pass
 * `--production` (`-p`) for a minified, source-map-free build.
 *
 * @category Build
 * @example
 * ```ts
 * // Dev build:
 * // bun zt inertia:build
 * // Production build:
 * // bun zt inertia:build --production
 * ```
 */
export class InertiaBuildCommand extends Command {
  static override commandName = "inertia:build";
  static override description =
    "Build the Inertia frontend bundle and regenerate the page registry";
  static override needsApp = false;

  static override flags = [
    {
      name: "production",
      short: "p",
      type: "boolean" as const,
      description: "Build for production (minified, no source maps)",
      default: false,
    },
  ];

  override async run(): Promise<void> {
    const isProd = this.flags["production"] as boolean;
    const cwd = process.cwd();

    // Step 1: Regenerate the page registry
    this.section("Regenerating page registry...");
    await generatePageRegistry(cwd);
    this.info("Page registry updated.");

    // Step 2: Build the frontend bundle with Bun.build
    this.section("Building frontend bundle...");

    const plugins = [...(await detectCssPlugins(cwd)), ...(await detectVuePlugin(cwd))];
    const outdir = `${cwd}/public/assets`;
    const result = await Bun.build({
      entrypoints: [`${cwd}/resources/js/app.tsx`],
      outdir,
      target: "browser",
      splitting: true, // REQUIRED: creates per-page chunks from dynamic imports
      minify: isProd,
      sourcemap: isProd ? "none" : "external",
      // `createInertiaApp()`'s `dev` option defaults to `import.meta.env.DEV`, which
      // Bun leaves in the bundle — so without this the client hooks the DevTools
      // extension reads are never enabled, and the panel tells you to start a Vite
      // server that a Zerotal app does not have.
      define: browserEnvDefines(isProd),
      ...(plugins.length > 0 ? { plugins } : {}),
    });

    if (!result.success) {
      for (const log of result.logs) {
        this.error(String(log));
      }
      throw new Error("Frontend build failed.");
    }

    // Chunks are named after their content, so the ones this build replaced
    // would otherwise stay behind — and ship.
    const removed = await pruneBuildOutput(outdir, result.outputs);

    this.info(`Build complete: ${result.outputs.length} files → public/assets/`);
    if (removed.length > 0) this.dim(`  Removed ${removed.length} stale file(s).`);

    this.table(
      result.outputs.map((o) => [
        o.path.replace(cwd, "").replace(/\\/g, "/"),
        `${(o.size / 1024).toFixed(1)} KB`,
      ]) as [string, string][],
    );
  }
}
