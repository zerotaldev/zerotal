import { readdir, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import type { ConfigManager } from "../../config/ConfigManager.ts";
import { _recordedBuildOutput } from "../../dev/BuildOutput.ts";
import type { AssetBuildConfig } from "../../dev/CssPlugins.ts";

/** Bundler-generated code-split chunk, e.g. `chunk-2502z4dn.js` (+ `.map`). */
const CHUNK_NAME = /^chunk-[a-z0-9]+\.js(\.map)?$/i;

/**
 * `bun zt assets:prune` — remove the chunks a previous release left behind.
 *
 * `assets:build --clean` cleans the directory it *builds into*, which is the build
 * machine. It does nothing for the common release shape: build here, tar the output,
 * extract it over `public/` there. Extracting a tarball merges — nothing removes a
 * file the new release does not contain — so every deploy adds another set of
 * content-hashed chunks to a directory that only ever grows. One app reached 225
 * chunk files on disk for the 49 its entry point references.
 *
 * Nothing breaks while that happens, which is why it runs for months unnoticed. The
 * accumulation even *masks* a stale-cache bug, because the pruned chunk an old
 * browser asks for is usually still lying there. But it grows without bound on a box
 * with a disk quota, and a release process that cannot say which files belong to the
 * current release is one that cannot clean up after itself.
 *
 * This is that answer. `assets:build` records what it wrote; ship `.zerotal/` with
 * the release and this removes what the record does not claim.
 *
 * ## What it will and will not delete
 *
 * Only two things qualify: a file an *earlier* recorded build wrote that the current
 * one did not, and a file named the way the bundler names a code-split chunk.
 * Everything else is left alone, because an output directory is usually `public/`,
 * where a blanket sweep takes the app's images and favicon with it.
 *
 * @example
 * ```bash
 * # on the server, after extracting the release and before the restart
 * bun zt assets:prune --dry-run   # list what would go
 * bun zt assets:prune
 * ```
 *
 * @category Build & assets
 */
export class AssetsPruneCommand extends Command {
  static override commandName = "assets:prune";
  static override description = "Remove asset files left behind by an earlier release";
  static override needsApp = true;

  static override flags = [
    {
      name: "dir",
      type: "string" as const,
      description: "Output directory to prune (defaults to the configured `app.assets.outDir`)",
    },
    {
      name: "dry-run",
      type: "boolean" as const,
      description: "List what would be removed, and remove none of it",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const dir = (this.flags["dir"] as string | undefined) ?? this._configuredOutDir();
    if (!dir) {
      this.warn(
        "No output directory to prune. Pass --dir, or configure app.assets.outDir in config/app.ts.",
      );
      return;
    }

    const root = resolve(cwd, dir);
    const recorded = new Set(await _recordedBuildOutput(root, cwd));
    if (recorded.size === 0) {
      // Without a record, "what belongs to this release" has no answer, and the
      // by-name sweep alone would be guessing about a directory it does not own.
      this.warn(
        `No build record for ${dir}. Run \`zt assets:build\` (and ship .zerotal/ with the ` +
          `release) so a prune knows which files are the current one's.`,
      );
      return;
    }

    const stale: string[] = [];
    for (const entry of await _listEntries(root)) {
      if (recorded.has(entry)) continue;
      if (!CHUNK_NAME.test(entry.split("/").at(-1) ?? "")) continue;
      stale.push(entry);
    }

    if (stale.length === 0) {
      this.info(`${dir}: nothing to prune — ${recorded.size} file(s) all accounted for.`);
      return;
    }

    if (this.flags["dry-run"] === true) {
      this.info(`${dir}: ${stale.length} file(s) would be removed:`);
      for (const path of stale.sort()) this.line(`  ${path}`);
      return;
    }

    let removed = 0;
    for (const path of stale) {
      try {
        await unlink(join(root, path));
        removed++;
      } catch {
        // Already gone, or held open. The next prune tries again, and a file we
        // could not delete is not worth failing a release over.
      }
    }
    this.info(`${dir}: removed ${removed} stale file(s), kept ${recorded.size}.`);
  }

  /** The configured asset output directory, or undefined when the app declares none. */
  private _configuredOutDir(): string | undefined {
    try {
      const config = (this.app as Application).container.makeSync("config") as ConfigManager;
      return (config.get("app.assets") as AssetBuildConfig | undefined)?.outDir;
    } catch {
      return undefined;
    }
  }
}

/** Every entry under `root`, relative and slash-normalised. Empty when unreadable. */
async function _listEntries(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true });
    return entries.map((entry) => relative(".", entry).split("\\").join("/"));
  } catch {
    return [];
  }
}
