import { Command } from "@zerotal/core";
import { pruneBuildOutput, cleanBuildOutput, browserEnvDefines } from "@zerotal/core/dev";
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
    {
      name: "clean",
      short: "c",
      type: "boolean" as const,
      description:
        "Delete everything in public/assets that this build did not write. " +
        "Without it, only chunks and files the last build on THIS machine recorded are removed",
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

    // `success` with no artefacts is not a build, and it is the shape that reaches
    // production: a deploy runs this, sees exit 0, restarts, and serves a page with
    // no script and no stylesheet. The health check passes — the server is fine, the
    // HTML is fine, there is simply nothing in it. An app had to assert the files
    // exist in its own deploy script to catch it, which is the framework's job.
    if (result.outputs.length === 0) {
      throw new Error(
        `Frontend build reported success and produced no files ` +
          `(entry point: resources/js/app.tsx). An empty output directory serves a ` +
          `page with no script and no stylesheet, which a health check cannot tell ` +
          `from a working one.`,
      );
    }

    // Chunks are named after their content, so the ones this build replaced
    // would otherwise stay behind — and ship.
    //
    // Which of the two runs matters most on a build machine that starts clean
    // every time. The prune's record of the last build lives in `.zerotal/`,
    // which is gitignored, so a fresh checkout has nothing to compare against
    // and only chunk-named files are recognised. `--clean` needs no record: this
    // directory belongs to the build, and what the build did not write does not
    // belong in it.
    const clean = this.flags["clean"] as boolean;
    const removed = clean
      ? await cleanBuildOutput(outdir, result.outputs)
      : await pruneBuildOutput(outdir, result.outputs);

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
