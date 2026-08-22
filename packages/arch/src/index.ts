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
// Subprocess plumbing, not API. `_probe.ts` carries the underscore this repo uses
// for a module nobody outside its package should reach for, nothing in the tree
// imports these from here, and the export block above says why the tools and the
// probe topics are public without ever saying why these are. Marked before the
// stable promise attaches, because withdrawing them afterwards is a breaking
// change made on behalf of a caller that does not exist.
/** @internal */
export { findApp, spawnProbe } from "./tools/_probe.ts";
/** @internal */
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

// The writers behind `arch:install`. Exported for the command and its tests to
// reach, not as API.
//
// They were public on the reasoning that "a project can generate the same files
// its own way" — a use nobody has, and a promise about the shape of `.mcp.json`
// writing, agent detection and marker fencing that would hold for the rest of
// the 1.x line. `ArchInstallCommand` is the only caller in the tree. Under `beta`
// that was a cheap bet; the stable label is what makes it expensive, so they are
// marked now rather than withdrawn later on behalf of a caller who never arrived.
/** @internal */
export { detectAgents } from "./install/detect.ts";
/** @internal */
export type { Detected, McpTarget } from "./install/detect.ts";
/** @internal */
export { applyMcpConfig, serverEntry, SERVER_ENTRY_PATH } from "./install/mcpConfig.ts";
/** @internal */
export type { ConfigOutcome } from "./install/mcpConfig.ts";
/** @internal */
export { applyBlock, fence, BLOCK_END, BLOCK_START } from "./install/markers.ts";
/** @internal */
export type { BlockOutcome } from "./install/markers.ts";
/** @internal */
export { agentsPreamble, buildGuidelines, claudeShim } from "./install/guidelines.ts";
/** @internal */
export type { GuidelineOptions } from "./install/guidelines.ts";
