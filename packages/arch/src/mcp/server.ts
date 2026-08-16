/**
 * Method dispatch and protocol-era negotiation.
 *
 * ## Why this speaks two protocols
 *
 * The 2026-07-28 revision made MCP stateless: it removed the
 * `initialize`/`notifications/initialized` handshake, moved the protocol
 * version into every request's `_meta`, and made `server/discover` mandatory.
 * That revision was published on 28 July 2026, and the clients in the field
 * still open with `initialize`.
 *
 * The spec's own compatibility matrix has exactly one row that works against
 * both kinds of client, and it is the dual-era server. So this one selects its
 * behaviour from how the caller opens — modern `_meta` on the request, or an
 * `initialize` handshake — and answers each request in the era it arrived in.
 *
 * `server/discover` carries a second job on stdio: it is the probe a dual-era
 * *client* sends to work out which kind of server it is talking to. Answering it
 * is what stops a modern client falling back to `initialize` against a server
 * that never needed it.
 *
 * ## What this file does not know
 *
 * Anything about Zerotal. It is handed an array of {@link ArchTool} and calls
 * them; every tool here would work unchanged behind a different transport.
 */
import { failure, success } from "./jsonrpc.ts";
import { LEGACY_VERSIONS, Meta, MODERN_VERSION, RpcError, SUPPORTED_VERSIONS } from "./types.ts";
import type {
  ArchTool,
  Era,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  ServerIdentity,
  ToolOutcome,
} from "./types.ts";

/** How long a client may cache `tools/list`. The set is fixed at build time. */
const LIST_TTL_MS = 3_600_000;

export interface McpServerOptions {
  identity: ServerIdentity;
  /**
   * The tools to expose, in the order they should be listed.
   *
   * Order is preserved rather than sorted: the spec asks for a deterministic
   * order so clients can cache and prompt caches can hit, and the registry's
   * own order is already deliberate — most useful first.
   */
  tools: readonly ArchTool[];
}

/** A request that is in flight, and the handle that cancels it. */
interface InFlight {
  controller: AbortController;
  cancelled: boolean;
}

export class McpServer {
  private readonly _identity: ServerIdentity;
  private readonly _tools: readonly ArchTool[];
  private readonly _byName: Map<string, ArchTool>;
  private readonly _inFlight = new Map<JsonRpcId, InFlight>();

  /**
   * The era the client established, once it has.
   *
   * Requests carrying modern `_meta` are self-describing and never need this;
   * it exists for the legacy era, where `initialize` sets the terms for every
   * request that follows.
   */
  private _negotiated: { era: Era; version: string } | undefined;

  constructor(options: McpServerOptions) {
    this._identity = options.identity;
    this._tools = options.tools;
    this._byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  }

  /**
   * Handle one request.
   *
   * Returns the reply to write, or `undefined` when there is nothing to say —
   * a notification, or a request that was cancelled while it ran. The spec is
   * strict about the second case: after `notifications/cancelled`, the server
   * MUST NOT send anything further for that id.
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    // Notifications carry no id and are never answered.
    if (request.id === undefined) {
      this._handleNotification(request);
      return undefined;
    }
    const id = request.id;

    const era = this._eraFor(request);
    if (era === "unsupported") {
      const requested = readProtocolVersion(request);
      return failure(id, RpcError.UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
        supported: [...SUPPORTED_VERSIONS],
        requested,
      });
    }

    switch (request.method) {
      case "server/discover":
        return success(id, this._discover());
      case "initialize":
        return success(id, this._initialize(request));
      case "ping":
        // Removed in the modern revision, but legacy clients send it as a
        // liveness check and expect an empty result. Cheaper to answer than to
        // explain.
        return success(id, this._decorate({}, era));
      case "tools/list":
        return success(id, this._listTools(era));
      case "tools/call":
        return this._callTool(id, request, era);
      default:
        return failure(id, RpcError.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
    }
  }

  // ── Era ─────────────────────────────────────────────────────────────────────

  /**
   * Which era this request is speaking, or `"unsupported"` when it names a
   * version this server does not implement.
   *
   * A request that carries `_meta` protocol version is self-describing and is
   * answered in the modern era whatever came before it — the spec treats the
   * version as a per-request property, not a connection-wide one. Everything
   * else falls back to what `initialize` negotiated, and then to legacy: a
   * client that sends `tools/list` cold is not a modern one, because a modern
   * client always states its version.
   */
  private _eraFor(request: JsonRpcRequest): Era | "unsupported" {
    // `initialize` and `server/discover` carry their own version negotiation and
    // must never be rejected before it happens — that would leave a client with
    // no way to find out what this server speaks.
    if (request.method === "initialize" || request.method === "server/discover") {
      return request.method === "initialize" ? "legacy" : "modern";
    }

    const declared = readProtocolVersion(request);
    if (declared !== undefined) {
      if (!(SUPPORTED_VERSIONS as readonly string[]).includes(declared)) return "unsupported";
      return declared === MODERN_VERSION ? "modern" : "legacy";
    }

    return this._negotiated?.era ?? "legacy";
  }

  // ── Methods ─────────────────────────────────────────────────────────────────

  /**
   * `server/discover` — what this server is and what it speaks.
   *
   * Mandatory in the modern revision, and doubly useful on stdio: it is also the
   * backward-compatibility probe, so answering it correctly is what tells a
   * dual-era client it need not fall back.
   */
  private _discover(): Record<string, unknown> {
    return {
      resultType: "complete",
      supportedVersions: [...SUPPORTED_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { ...this._identity },
      _meta: { [Meta.SERVER_INFO]: { ...this._identity } },
    };
  }

  /** The legacy handshake. Echoes a version both ends know. */
  private _initialize(request: JsonRpcRequest): Record<string, unknown> {
    const requested = request.params?.["protocolVersion"];
    const version =
      typeof requested === "string" && (LEGACY_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LEGACY_VERSIONS[0];

    this._negotiated = { era: "legacy", version };

    return {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { ...this._identity },
    };
  }

  private _listTools(era: Era): Record<string, unknown> {
    const tools = this._tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));

    if (era === "legacy") return { tools };

    // `ttlMs` and `cacheScope` are required on a modern list result. `private`
    // because the answer is specific to this project's checkout — nothing about
    // it is safe for a shared intermediary to serve to someone else.
    return this._decorate({ tools, ttlMs: LIST_TTL_MS, cacheScope: "private" }, era);
  }

  private async _callTool(
    id: JsonRpcId,
    request: JsonRpcRequest,
    era: Era,
  ): Promise<JsonRpcResponse | undefined> {
    const name = request.params?.["name"];
    if (typeof name !== "string") {
      return failure(id, RpcError.INVALID_PARAMS, "tools/call requires a string `name`.");
    }
    const tool = this._byName.get(name);
    if (!tool) {
      return failure(id, RpcError.INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    const rawArgs = request.params?.["arguments"];
    const args =
      typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};

    const entry: InFlight = { controller: new AbortController(), cancelled: false };
    this._inFlight.set(id, entry);

    let outcome: ToolOutcome;
    try {
      outcome = await tool.run(args, entry.controller.signal);
    } catch (error) {
      // A tool that throws has still *run*. Reporting that as a protocol error
      // would hide it from the model, which is the one party able to correct it.
      outcome = { text: describe(error), failed: true };
    } finally {
      this._inFlight.delete(id);
    }

    if (entry.cancelled) return undefined;
    return success(id, this._renderOutcome(outcome, era));
  }

  /**
   * A tool outcome as MCP content.
   *
   * The spec suggests a tool returning structured content also repeat it as
   * serialised JSON in a text block, for clients that do not read
   * `structuredContent`. That is skipped deliberately here: every tool in this
   * package renders its full answer into `text` already, so the extra block
   * would be the same information twice in a model's context window rather than
   * a fallback for anything it would otherwise miss.
   */
  private _renderOutcome(outcome: ToolOutcome, era: Era): Record<string, unknown> {
    const result: Record<string, unknown> = {
      content: [{ type: "text", text: outcome.text }],
      isError: outcome.failed === true,
    };
    if (outcome.data !== undefined) result["structuredContent"] = outcome.data;
    return this._decorate(result, era);
  }

  /** Add the fields a modern result carries and a legacy one does not. */
  private _decorate(result: Record<string, unknown>, era: Era): Record<string, unknown> {
    if (era === "legacy") return result;
    return {
      resultType: "complete",
      ...result,
      _meta: { [Meta.SERVER_INFO]: { ...this._identity } },
    };
  }

  // ── Notifications ───────────────────────────────────────────────────────────

  private _handleNotification(request: JsonRpcRequest): void {
    if (request.method === "notifications/cancelled") {
      const target = request.params?.["requestId"];
      if (typeof target === "string" || typeof target === "number") {
        const entry = this._inFlight.get(target);
        if (entry) {
          entry.cancelled = true;
          entry.controller.abort();
        }
      }
      return;
    }
    // `notifications/initialized` closes the legacy handshake and needs nothing
    // done. Anything else is a notification this server has no interest in, and
    // notifications are by definition not answered — including with an error.
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The protocol version a modern request declares in `_meta`, if it declares one. */
function readProtocolVersion(request: JsonRpcRequest): string | undefined {
  const meta = request.params?.["_meta"];
  if (typeof meta !== "object" || meta === null) return undefined;
  const version = (meta as Record<string, unknown>)[Meta.PROTOCOL_VERSION];
  return typeof version === "string" ? version : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
