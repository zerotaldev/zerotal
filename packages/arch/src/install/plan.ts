/**
 * What `arch:install` would write into a project, computed without writing it.
 *
 * Kept apart from the command so the starters can ship exactly these files. A
 * new app carries the agent surface from its first commit, and the files it
 * carries are the ones this function produces for that starter — so the first
 * `arch:update` after scaffolding has nothing to change, and `doctor` finds
 * nothing to warn about. Two generators for the same files would disagree on
 * the first release that touched one of them.
 */
import { join } from "node:path";
import type { ArchConfigShape } from "../config.ts";
import { declaredPackages } from "../probe/topics.ts";
import { detectAgents } from "./detect.ts";
import type { McpTarget } from "./detect.ts";
import { agentsPreamble, buildGuidelines, claudeShim } from "./guidelines.ts";
import { applyBlock } from "./markers.ts";
import { applyMcpConfig } from "./mcpConfig.ts";
import { detectShape } from "./shape.ts";
import type { ProjectShape } from "./shape.ts";
import { renderSkill, selectSkills, skillPaths, SKILL_MARKER } from "./skills.ts";

/** One file the run touches, and what happens to it. */
export interface Change {
  path: string;
  status: "created" | "updated" | "unchanged" | "conflict";
  detail?: string;
  text?: string;
}

export interface InstallPlan {
  /** Agent tooling found in the project, by name. */
  agents: string[];
  changes: Change[];
}

export interface PlanOptions {
  /**
   * The `@zerotal/*` packages to describe. Read from the project when omitted —
   * see {@link declaredPackages}. Given explicitly for a project with nothing
   * installed yet, which is what a starter is before its first `bun install`.
   */
  packages?: readonly string[] | undefined;
}

/** Every change `arch:install` would make in `root` under `config`. */
export async function planInstall(
  root: string,
  config: ArchConfigShape,
  options: PlanOptions = {},
): Promise<InstallPlan> {
  const detected = await detectAgents(root);
  // Declared, not installed: what an install layout hoists into node_modules
  // differs between machines, and the guidance must not.
  const packages = options.packages
    ? [...options.packages]
    : (await declaredPackages(root)).map((pkg) => pkg.name);
  // Read off disk rather than from a booted app: a project that will not boot is
  // often exactly why someone is installing the agent surface.
  const shape = await detectShape(root);

  const changes: Change[] = [
    ...(config.mcpConfig ? await mcpChanges(root, config, detected.targets) : []),
    ...(config.agentsFile ? [await agentsChange(root, config, packages, shape)] : []),
    ...(config.claudeFile ? [await claudeChange(root)] : []),
    ...(config.skills ? await skillChanges(root, packages, shape, detected.agents) : []),
  ];

  return { agents: detected.agents, changes };
}

async function mcpChanges(
  root: string,
  config: ArchConfigShape,
  detected: McpTarget[],
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

async function agentsChange(
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
async function skillChanges(
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

async function claudeChange(root: string): Promise<Change> {
  const outcome = applyBlock(await readIfPresent(join(root, "CLAUDE.md")), claudeShim());
  return outcome.status === "conflict"
    ? { path: "CLAUDE.md", status: "conflict", detail: outcome.reason }
    : { path: "CLAUDE.md", status: outcome.status, text: outcome.text };
}

async function readIfPresent(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
}
