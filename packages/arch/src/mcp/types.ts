/**
 * The vocabulary shared by the transport and the tools — and the seam between
 * them.
 *
 * A tool is a plain object: a name, a description, a JSON Schema, and a `run`.
 * It knows nothing about JSON-RPC, and nothing in `mcp/` knows what a Zerotal
 * app is. That separation is what lets every tool be tested with no transport
 * and the transport be tested with no app, and it is what leaves room for a
 * second transport later without touching a single tool.
 */

// ── The tool contract ─────────────────────────────────────────────────────────

/**
 * A JSON Schema document, kept deliberately loose.
 *
 * The 2026-07-28 revision widened `inputSchema` to allow any JSON Schema
 * 2020-12 keyword, so a narrow hand-written type here would reject valid
 * schemas rather than catch mistakes.
 */
export type JsonSchema = Record<string, unknown>;

/** What a tool returns. Rendered into MCP content blocks by the server. */
export interface ToolOutcome {
  /** Prose for the model. Always present, even when `data` carries the detail. */
  text: string;
  /**
   * The machine-readable payload, matching the tool's `outputSchema`.
   * Serialised into `structuredContent`.
   */
  data?: unknown;
  /**
   * The tool ran and could not do what was asked — a missing file, an app that
   * would not boot, a package that is not installed.
   *
   * Reported as `isError: true` on an otherwise ordinary result, never as a
   * JSON-RPC error: the spec is explicit that execution errors are the ones a
   * model can read and self-correct from, while protocol errors are not.
   */
  failed?: boolean;
}

/** One tool the server exposes. */
export interface ArchTool {
  /** Wire name. Lowercase with underscores, to match the rest of the ecosystem. */
  name: string;
  /** Human-readable name for display. */
  title: string;
  /**
   * What the tool does, written for a model deciding whether to call it.
   *
   * This is the single most load-bearing string in the package: a tool the
   * agent never reaches for is a tool that does not exist.
   */
  description: string;
  /** JSON Schema for `arguments`. Use `{type: "object", additionalProperties: false}` for none. */
  inputSchema: JsonSchema;
  /** JSON Schema for `data`. Present on every tool here — the shape is the point. */
  outputSchema: JsonSchema;
  run(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome>;
}

// ── JSON-RPC 2.0 ──────────────────────────────────────────────────────────────

/** A JSON-RPC id. `null` is reserved for replies to unparseable input. */
export type JsonRpcId = string | number;

/** An inbound message. A request has an `id`; a notification does not. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/**
 * JSON-RPC error codes, plus the one MCP allocates.
 *
 * The 2026-07-28 revision partitioned the server-error range: `-32000`…`-32019`
 * stays implementation-defined and `-32020`…`-32099` is reserved for the spec,
 * which is why `UNSUPPORTED_PROTOCOL_VERSION` is `-32022` and not the `-32004`
 * an earlier draft used.
 */
export const RpcError = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

// ── Protocol versions ─────────────────────────────────────────────────────────

/**
 * The revision that made MCP stateless: no `initialize`, per-request `_meta`,
 * a mandatory `server/discover`.
 */
export const MODERN_VERSION = "2026-07-28";

/**
 * Handshake-based revisions, newest first.
 *
 * These are still what shipping clients open with — the modern revision was
 * published on 28 July 2026 — so serving them is not a courtesy, it is the
 * only way the server is usable today. The list is the negotiation preference
 * order for `initialize`.
 */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** Everything this server speaks, newest first. Advertised by `server/discover`. */
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS] as const;

/**
 * `_meta` keys the modern revision defines. Prefixed, per the naming rules.
 */
export const Meta = {
  PROTOCOL_VERSION: "io.modelcontextprotocol/protocolVersion",
  CLIENT_INFO: "io.modelcontextprotocol/clientInfo",
  CLIENT_CAPABILITIES: "io.modelcontextprotocol/clientCapabilities",
  SERVER_INFO: "io.modelcontextprotocol/serverInfo",
} as const;

/** Which era a request is speaking. Selected per request, not per connection. */
export type Era = "modern" | "legacy";

/** Identity this server reports in `serverInfo`. */
export interface ServerIdentity {
  name: string;
  title: string;
  version: string;
}
