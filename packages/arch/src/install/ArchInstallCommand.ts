/**
 * `bun zt arch:install` — register the MCP server and write the agent
 * instructions. Also registered as `arch:update`, because re-running it *is* the
 * update: every write is a merge into a fenced region, so the second run and the
 * fiftieth do the same thing.
 *
 * That idempotence is the contract, not a nicety. This command runs again on
 * every framework upgrade, against files a developer is invited to edit. A run
 * that clobbered a hand-written paragraph would be discovered once and never
 * trusted again — so anything it cannot merge cleanly it reports and leaves
 * alone.
 */
import { dirname, join } from "node:path";
import { Command } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { ArchConfig } from "../config.ts";
import type { ArchConfigShape } from "../config.ts";
import { NoProjectRootError } from "../errors.ts";
import { planInstall } from "./plan.ts";

export class ArchInstallCommand extends Command {
  static override commandName = "arch:install";
  static override description =
    "Register the Zerotal MCP server and write agent instructions (alias: arch:update)";
  static override needsApp = true;
  static override args = [];
  static override flags = [
    {
      name: "dry",
      type: "boolean" as const,
      description: "Show what would change without writing anything",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const dry = this.flags["dry"] === true;
    const root = await findProjectRoot(process.cwd());
    const config = this._config();

    const { agents, changes } = await planInstall(root, config);

    this.section(dry ? "arch:install — dry run" : "arch:install");
    if (agents.length > 0) {
      this.dim(`  detected: ${agents.join(", ")}`);
    } else {
      this.dim("  no agent tooling detected — writing the portable defaults");
    }
    this.newLine();

    let wrote = 0;
    let conflicts = 0;

    for (const change of changes) {
      if (change.status === "conflict") {
        conflicts++;
        this.error(`  ✗ ${change.path} — ${change.detail ?? "left untouched"}`);
        continue;
      }
      if (change.status === "unchanged") {
        this.dim(`  · ${change.path} — ${change.detail ?? "already up to date"}`);
        continue;
      }
      if (!dry && change.text !== undefined) {
        await Bun.write(join(root, change.path), change.text);
      }
      wrote++;
      this.info(
        `  ${dry ? "would " : ""}${change.status === "created" ? "create" : "update"} ${change.path}`,
      );
    }

    this.newLine();
    if (conflicts > 0) {
      this.warn(
        `${conflicts} file(s) could not be merged and were left as they are. ` +
          `Fix the markers or the JSON and run this again.`,
      );
    }
    if (dry) {
      this.line(`${wrote} file(s) would change. Run without --dry to apply.`);
      return;
    }
    if (wrote === 0) {
      this.line("Everything is already in place.");
      return;
    }
    this.line("Restart your agent so it picks up the MCP server.");
  }

  /** The `arch` config namespace, or the defaults when the app declares none. */
  private _config(): ArchConfigShape {
    const app = this.app as Application | undefined;
    try {
      const store = app?.container.makeSync("config") as
        { get(key: string, fallback?: unknown): unknown } | undefined;
      const declared = store?.get("arch", {});
      return ArchConfig((declared ?? {}) as Partial<ArchConfigShape>);
    } catch {
      return ArchConfig();
    }
  }
}

/** The nearest ancestor with a `package.json`. */
async function findProjectRoot(start: string): Promise<string> {
  let dir = start;
  for (;;) {
    if (await Bun.file(join(dir, "package.json")).exists()) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new NoProjectRootError(start);
    dir = parent;
  }
}
