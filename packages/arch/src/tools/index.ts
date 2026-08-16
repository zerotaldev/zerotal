/**
 * The tool registry.
 *
 * Order is the listing order and is deliberate: `tools/list` preserves it, and
 * it is the first thing a model reads about this server. Cheap orientation
 * first (`app_info`), then the two that answer "what exactly does this API look
 * like" (`api_surface`, `search_docs`), then the app's own state, then the
 * verification tools a task should end with.
 */
import type { ArchTool } from "../mcp/types.ts";
import type { ToolContext } from "./context.ts";
import { apiSurfaceTool } from "./apiSurface.ts";
import { appInfoTool } from "./appInfo.ts";
import { baselinesTool } from "./baselines.ts";
import { doctorTool } from "./doctor.ts";
import { lastErrorTool, logsTool } from "./logs.ts";
import { routesTool } from "./routes.ts";
import { schemaTool } from "./schema.ts";
import { searchDocsTool } from "./searchDocs.ts";

/** Every tool the agent surface exposes, in listing order. */
export function archTools(ctx: ToolContext): ArchTool[] {
  return [
    appInfoTool(ctx),
    apiSurfaceTool(ctx),
    searchDocsTool(ctx),
    routesTool(ctx),
    schemaTool(ctx),
    logsTool(ctx),
    lastErrorTool(ctx),
    baselinesTool(ctx),
    doctorTool(ctx),
  ];
}

export {
  apiSurfaceTool,
  appInfoTool,
  baselinesTool,
  doctorTool,
  lastErrorTool,
  logsTool,
  routesTool,
  schemaTool,
  searchDocsTool,
};
export type { ToolContext } from "./context.ts";
export { vendoredDocsDir } from "./context.ts";
export { findApp, spawnProbe } from "./_probe.ts";
export type { ProbeResult, ProbeRunner, SpawnProbeOptions } from "./_probe.ts";
