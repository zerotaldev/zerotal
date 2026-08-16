/**
 * `@zerotal/arch` — the agent surface.
 *
 * A coding agent working in a Zerotal app should not have to recall an API, or
 * guess a route name, or say "looks fine to me". The framework already produces
 * the answers mechanically: `api-surface.md` records every export's exact
 * signature, `runDoctor()` returns structured findings with a fix beside each,
 * the router knows its routes and the ORM knows its columns. This package hands
 * all of it over as MCP tools.
 *
 * Install it into a project with `bun zt arch:install`. The server itself is a
 * bin — `node_modules/@zerotal/arch/src/bin/mcp.ts` — and deliberately never
 * boots the application; see that file for the reasoning.
 */

// The provider, which registers `arch:install`, `arch:update` and `arch:probe`.
export { ArchProvider } from "./provider/ArchProvider.ts";

// Config factory + its shape.
export { ArchConfig } from "./config.ts";
export type { ArchConfigShape } from "./config.ts";

// Typed error vocabulary.
export * from "./errors.ts";

// The tools, and the context they are built from. Exported so a project can
// serve a subset, or add its own alongside them.
export { archTools, vendoredDocsDir } from "./tools/index.ts";
export type { ToolContext } from "./tools/index.ts";
export { findApp, spawnProbe } from "./tools/_probe.ts";
export type { ProbeResult, ProbeRunner, SpawnProbeOptions } from "./tools/_probe.ts";

// The in-app reads, for anyone wanting them without the subprocess.
export { PROBE_TOPICS, isProbeTopic, probe } from "./probe/topics.ts";
export type {
  AppInfo,
  DoctorFinding,
  DoctorReport,
  InstalledPackage,
  ProbeTopic,
  RouteEntry,
  RouteReport,
  SchemaColumn,
  SchemaModel,
  SchemaReport,
} from "./probe/topics.ts";

// The install writers, so a project can generate the same files its own way.
export { detectAgents } from "./install/detect.ts";
export type { Detected, McpTarget } from "./install/detect.ts";
export { applyMcpConfig, serverEntry, SERVER_ENTRY_PATH } from "./install/mcpConfig.ts";
export type { ConfigOutcome } from "./install/mcpConfig.ts";
export { applyBlock, fence, BLOCK_END, BLOCK_START } from "./install/markers.ts";
export type { BlockOutcome } from "./install/markers.ts";
export { agentsPreamble, buildGuidelines, claudeShim } from "./install/guidelines.ts";
export type { GuidelineOptions } from "./install/guidelines.ts";
