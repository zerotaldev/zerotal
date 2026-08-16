/**
 * The transport half of `@zerotal/arch`, exported on its own subpath.
 *
 * Nothing here knows what a Zerotal app is. It is published separately from the
 * root barrel so a package can build its own MCP server over these pieces —
 * hand {@link McpServer} an array of {@link ArchTool} and serve it — without
 * pulling in the tools, the probe command, or the vendored docs.
 */
export { McpServer } from "./server.ts";
export type { McpServerOptions } from "./server.ts";
export { serveStdio } from "./stdio.ts";
export type { StdioOptions } from "./stdio.ts";
export { decodeFrame, encodeFrame, failure, success } from "./jsonrpc.ts";
export type { DecodedFrame } from "./jsonrpc.ts";
export { LEGACY_VERSIONS, Meta, MODERN_VERSION, RpcError, SUPPORTED_VERSIONS } from "./types.ts";
export type {
  ArchTool,
  Era,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  JsonSchema,
  ServerIdentity,
  ToolOutcome,
} from "./types.ts";
