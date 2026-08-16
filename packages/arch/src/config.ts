import { deepMerge } from "@zerotal/core";

/**
 * What `zt arch:install` writes, and under what name.
 *
 * Only the install side is configurable. The MCP server itself never boots an
 * application, so it can read no config — which is the point of it, and the
 * reason there is nothing here about tools or transports.
 */
export interface ArchConfigShape {
  /**
   * Write `AGENTS.md`, the cross-tool instruction file. Default: `true`.
   *
   * Read natively by Cursor, Copilot, Codex, Gemini CLI, Aider, Windsurf and
   * Zed, so it is where the guidelines belong even in a single-tool project.
   */
  agentsFile: boolean;
  /**
   * Write a `CLAUDE.md` that imports `AGENTS.md`. Default: `true`.
   *
   * A one-line shim rather than a second copy: Claude Code does not read
   * `AGENTS.md` natively, and two files of guidance drift apart.
   */
  claudeFile: boolean;
  /** Write the MCP client configuration. Default: `true`. */
  mcpConfig: boolean;
  /** Path of the MCP client config, relative to the project root. */
  mcpConfigPath: string;
  /**
   * The key this server is registered under in the MCP config. Default: `zerotal`.
   *
   * Worth changing only when a project already has a server by that name.
   */
  serverName: string;
}

const defaults: ArchConfigShape = {
  agentsFile: true,
  claudeFile: true,
  mcpConfig: true,
  mcpConfigPath: ".mcp.json",
  serverName: "zerotal",
};

/**
 * Build an {@link ArchConfigShape} with defaults applied.
 *
 * @example
 * ```ts
 * // config/arch.ts
 * import { ArchConfig } from "@zerotal/arch";
 * export default ArchConfig({ claudeFile: false });
 * ```
 */
export function ArchConfig(options: Partial<ArchConfigShape> = {}): ArchConfigShape {
  return deepMerge(defaults, options);
}

declare module "@zerotal/core" {
  interface ConfigRegistry {
    arch: ArchConfigShape;
  }
}
