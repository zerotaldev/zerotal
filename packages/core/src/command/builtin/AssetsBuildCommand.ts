import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import type { ConfigManager } from "../../config/ConfigManager.ts";
import { buildConfiguredAssets, type AssetBuildConfig } from "../../dev/CssPlugins.ts";

/**
 * `bun zt assets:build` — build every frontend bundle this app declares, in one step,
 * as part of a release rather than as a side effect of starting the server.
 *
 * `serve` builds at boot, which is right in development and awkward in production: it
 * makes the server process need write access to its own output directory, so a properly
 * hardened unit (`ProtectSystem=strict`) restart-loops on a read-only filesystem. Running
 * this at deploy time means `serve` finds the output already there, skips the build, and
 * needs no write access at all.
 *
 * Covers both sources of bundles:
 *   - `app.assets` from `config/app.ts` (whatever entrypoints it names)
 *   - Flow's conventional entry points, `resources/css/app.css` and `resources/js/app.js`
 *
 * Inertia apps build with `bun zt inertia:build` instead — this does not duplicate it.
 *
 * @category Build & assets
 */
export class AssetsBuildCommand extends Command {
  static override commandName = "assets:build";
  static override description = "Build all configured frontend bundles for a release";
  static override needsApp = true;

  static override flags = [
    {
      name: "minify",
      short: "m",
      type: "boolean" as const,
      description: "Minify the output",
      default: true,
    },
  ];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const minify = this.flags["minify"] as boolean;
    let built = 0;
    let failed = 0;

    const assets = this._assetsConfig();
    if (assets) {
      const entries = Array.isArray(assets.entrypoint)
        ? assets.entrypoint.join(", ")
        : assets.entrypoint;
      this.info(`Building assets: ${entries} → ${assets.outDir}/`);
      const result = await buildConfiguredAssets({ ...assets, minify }, cwd);
      if (result.success) built++;
      else {
        failed++;
        this.error("Asset build failed:");
        for (const log of result.logs ?? []) console.error(log);
      }
    }

    // Flow's own bundles. Built by entry-point convention rather than config, which is
    // why they are easy to forget in a release script and easy to discover here.
    const { buildCssBundle, buildJsBundle } = await import("../../dev/CssPlugins.ts");
    const conventional = [
      { entry: "resources/css/app.css", outDir: "public/css", build: buildCssBundle },
      { entry: "resources/js/app.js", outDir: "public/js", build: buildJsBundle },
    ];
    for (const { entry, outDir, build } of conventional) {
      if (!(await Bun.file(`${cwd}/${entry}`).exists())) continue;
      this.info(`Building ${entry} → ${outDir}/`);
      const result = await build(`${cwd}/${entry}`, `${cwd}/${outDir}`, minify);
      if (result.success) built++;
      else {
        failed++;
        this.error(`${entry} build failed:`);
        for (const log of result.logs ?? []) console.error(log);
      }
    }

    if (built === 0 && failed === 0) {
      this.info("No frontend bundles configured — nothing to build.");
      return;
    }
    if (failed > 0) {
      this.error(`${failed} bundle(s) failed, ${built} succeeded.`);
      process.exit(1);
      return;
    }
    this.info(`Built ${built} bundle(s).`);
  }

  /** Read the resolved `app.assets` config block, or undefined when not configured. */
  private _assetsConfig(): AssetBuildConfig | undefined {
    try {
      const config = (this.app as Application).container.makeSync("config") as ConfigManager;
      return config.get("app.assets") as AssetBuildConfig | undefined;
    } catch {
      return undefined;
    }
  }
}
