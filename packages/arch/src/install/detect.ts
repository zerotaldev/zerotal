/**
 * Which coding agents this project is already set up for.
 *
 * Detection is by the directories and files an agent leaves behind, not by
 * asking. A project with `.cursor/` gets a Cursor MCP config; one without does
 * not get a directory it never wanted. The one exception is `.mcp.json` at the
 * root, which is written unconditionally: it is the widely-read project-scoped
 * location, and a project with no agent configured yet is exactly the project
 * about to configure one.
 */
import { join } from "node:path";

/** Where an MCP client keeps its server list, and under which key. */
export interface McpTarget {
  /** Path relative to the project root. */
  path: string;
  /**
   * The object servers are listed under.
   *
   * Most clients use `mcpServers`; VS Code's own file uses `servers`. Writing
   * the wrong one produces a config that parses and does nothing.
   */
  key: "mcpServers" | "servers";
  /** What reads this file, for the report. */
  client: string;
}

export interface Detected {
  /** Agent tooling found in the project, by name. */
  agents: string[];
  /** MCP config files worth writing here. */
  targets: McpTarget[];
}

interface Probe {
  agent: string;
  /** A path whose existence means this agent is in use. */
  marker: string;
  target?: McpTarget;
}

const PROBES: Probe[] = [
  {
    agent: "Claude Code",
    marker: ".claude",
    target: { path: ".mcp.json", key: "mcpServers", client: "Claude Code" },
  },
  {
    agent: "Cursor",
    marker: ".cursor",
    target: { path: ".cursor/mcp.json", key: "mcpServers", client: "Cursor" },
  },
  {
    agent: "VS Code / Copilot",
    marker: ".vscode",
    target: { path: ".vscode/mcp.json", key: "servers", client: "VS Code" },
  },
  { agent: "GitHub Copilot", marker: ".github/copilot-instructions.md" },
  { agent: "Gemini CLI", marker: ".gemini" },
  { agent: "Codex", marker: ".codex" },
  { agent: "Windsurf", marker: ".windsurf" },
];

/** The config every project gets, whatever it already has. */
const DEFAULT_TARGET: McpTarget = {
  path: ".mcp.json",
  key: "mcpServers",
  client: "Claude Code and other clients reading .mcp.json",
};

export async function detectAgents(root: string): Promise<Detected> {
  const agents: string[] = [];
  const targets = new Map<string, McpTarget>([[DEFAULT_TARGET.path, DEFAULT_TARGET]]);

  for (const probe of PROBES) {
    if (!(await exists(join(root, probe.marker)))) continue;
    agents.push(probe.agent);
    if (probe.target) targets.set(probe.target.path, probe.target);
  }

  return { agents, targets: [...targets.values()] };
}

/**
 * Whether a path exists, directory or file.
 *
 * `Bun.file(dir).exists()` answers `false` for a directory, so the markers here
 * — most of which are directories — need the stat.
 */
async function exists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
