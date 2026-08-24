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
import { declaredPackages } from "../probe/topics.ts";
import { detectAgents } from "./detect.ts";
import { agentsPreamble, buildGuidelines, claudeShim } from "./guidelines.ts";
import { detectShape } from "./shape.ts";
import { selectSkills, renderSkill, skillPaths, SKILL_MARKER } from "./skills.ts";
import type { ProjectShape } from "./shape.ts";
import { applyBlock } from "./markers.ts";
import { applyMcpConfig } from "./mcpConfig.ts";

/** One file the run touched, and what happened to it. */
interface Change {
  path: string;
  status: "created" | "updated" | "unchanged" | "conflict";
  detail?: string;
  text?: string;
}

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

    const detected = await detectAgents(root);
    // Declared, not installed: what an install layout hoists into node_modules
    // differs between machines, and the guidance must not.
    const packages = (await declaredPackages(root)).map((pkg) => pkg.name);
    // Read off disk rather than from a booted app: a project that will not boot is
    // often exactly why someone is installing the agent surface.
    const shape = await detectShape(root);

    const changes: Change[] = [
      ...(config.mcpConfig ? await this._mcpChanges(root, config, detected.targets) : []),
      ...(config.agentsFile ? [await this._agentsChange(root, config, packages, shape)] : []),
      ...(config.claudeFile ? [await this._claudeChange(root)] : []),
      ...(config.skills ? await this._skillChanges(root, packages, shape, detected.agents) : []),
    ];

    this.section(dry ? "arch:install — dry run" : "arch:install");
    if (detected.agents.length > 0) {
      this.dim(`  detected: ${detected.agents.join(", ")}`);
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

  private async _mcpChanges(
    root: string,
    config: ArchConfigShape,
    detected: Awaited<ReturnType<typeof detectAgents>>["targets"],
  ): Promise<Change[]> {
    // The configured path always gets written; the detected ones are extra.
    const targets = detected.some((target) => target.path === config.mcpConfigPath)
      ? detected
      : [
          { path: config.mcpConfigPath, key: "mcpServers" as const, client: "MCP client" },
          ...detected,
        ];

    const changes: Change[] = [];
    for (const target of targets) {
      const outcome = applyMcpConfig(
        await readIfPresent(join(root, target.path)),
        config.serverName,
        target,
      );
      changes.push(
        outcome.status === "conflict"
          ? { path: target.path, status: "conflict", detail: outcome.reason }
          : { path: target.path, status: outcome.status, text: outcome.text },
      );
    }
    return changes;
  }

  private async _agentsChange(
    root: string,
    config: ArchConfigShape,
    packages: string[],
    shape: ProjectShape,
  ): Promise<Change> {
    const outcome = applyBlock(
      await readIfPresent(join(root, "AGENTS.md")),
      buildGuidelines({ packages, serverName: config.serverName, shape }),
      agentsPreamble(),
    );
    return outcome.status === "conflict"
      ? { path: "AGENTS.md", status: "conflict", detail: outcome.reason }
      : { path: "AGENTS.md", status: outcome.status, text: outcome.text };
  }

  /**
   * The skill files, one per applicable skill per agent directory.
   *
   * A file without {@link SKILL_MARKER} is left exactly as it is. That is the
   * whole override mechanism: to replace a skill this ships, edit it and delete
   * the marker line. Anything cleverer would be a second config to keep in step
   * with the thing it configures.
   */
  private async _skillChanges(
    root: string,
    packages: string[],
    shape: ProjectShape,
    agents: string[],
  ): Promise<Change[]> {
    const changes: Change[] = [];

    for (const skill of selectSkills(packages, shape)) {
      const text = renderSkill(skill, shape);
      for (const path of skillPaths(skill.name, agents)) {
        const existing = await readIfPresent(join(root, path));
        if (existing !== undefined && !existing.includes(SKILL_MARKER)) {
          changes.push({ path, status: "unchanged", detail: "yours — left alone" });
          continue;
        }
        changes.push(
          existing === text
            ? { path, status: "unchanged" }
            : { path, status: existing === undefined ? "created" : "updated", text },
        );
      }
    }

    return changes;
  }

  private async _claudeChange(root: string): Promise<Change> {
    const outcome = applyBlock(await readIfPresent(join(root, "CLAUDE.md")), claudeShim());
    return outcome.status === "conflict"
      ? { path: "CLAUDE.md", status: "conflict", detail: outcome.reason }
      : { path: "CLAUDE.md", status: outcome.status, text: outcome.text };
  }
}

async function readIfPresent(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
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
