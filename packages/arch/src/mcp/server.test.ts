import { describe, it, expect } from "bun:test";
import { McpServer } from "./server.ts";
import { LEGACY_VERSIONS, Meta, MODERN_VERSION, RpcError, SUPPORTED_VERSIONS } from "./types.ts";
import type { ArchTool, JsonRpcRequest, JsonRpcResponse } from "./types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const identity = { name: "zerotal-arch", title: "Zerotal", version: "1.7.0" };

function tool(overrides: Partial<ArchTool> & { name: string }): ArchTool {
  return {
    title: overrides.name,
    description: `the ${overrides.name} tool`,
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: { type: "object" },
    run: async () => ({ text: `ran ${overrides.name}` }),
    ...overrides,
  };
}

/** Two tools whose registry order is deliberately *not* alphabetical. */
const tools: ArchTool[] = [
  tool({ name: "zulu", run: async () => ({ text: "z", data: { which: "zulu" } }) }),
  tool({ name: "alpha" }),
];

const serve = (extra: ArchTool[] = []): McpServer =>
  new McpServer({ identity, tools: [...tools, ...extra] });

function request(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) } as JsonRpcRequest;
}

/** The same request, tagged as modern. */
function modern(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return request(method, { ...params, _meta: { [Meta.PROTOCOL_VERSION]: MODERN_VERSION } }, id);
}

const resultOf = (response: JsonRpcResponse | undefined): Record<string, unknown> => {
  if (response === undefined || !("result" in response)) {
    throw new Error(`expected a result, got ${JSON.stringify(response)}`);
  }
  return response.result;
};

const errorOf = (response: JsonRpcResponse | undefined) => {
  if (response === undefined || !("error" in response)) {
    throw new Error(`expected an error, got ${JSON.stringify(response)}`);
  }
  return response.error;
};

// ── server/discover ───────────────────────────────────────────────────────────

describe("server/discover", () => {
  it("advertises every supported version, newest first", async () => {
    const result = resultOf(await serve().handle(request("server/discover")));
    expect(result["supportedVersions"]).toEqual([...SUPPORTED_VERSIONS]);
    expect((result["supportedVersions"] as string[])[0]).toBe(MODERN_VERSION);
  });

  it("declares the tools capability and its identity", async () => {
    const result = resultOf(await serve().handle(request("server/discover")));
    expect(result["capabilities"]).toEqual({ tools: { listChanged: false } });
    expect(result["serverInfo"]).toEqual(identity);
    expect(result["resultType"]).toBe("complete");
  });

  it("answers without a handshake — it is the stdio compatibility probe", async () => {
    // A dual-era client sends this first, cold. Returning an error here is what
    // makes it decide this server is legacy and fall back to `initialize`.
    const response = await serve().handle(request("server/discover"));
    expect(response && "result" in response).toBe(true);
  });
});

// ── initialize ────────────────────────────────────────────────────────────────

describe("initialize", () => {
  it("echoes a legacy version the client asked for", async () => {
    const result = resultOf(
      await serve().handle(request("initialize", { protocolVersion: "2025-06-18" })),
    );
    expect(result["protocolVersion"]).toBe("2025-06-18");
    expect(result["serverInfo"]).toEqual(identity);
  });

  it("falls back to its newest legacy version when the client asks for something else", async () => {
    const result = resultOf(
      await serve().handle(request("initialize", { protocolVersion: "1999-01-01" })),
    );
    expect(result["protocolVersion"]).toBe(LEGACY_VERSIONS[0]);
  });

  it("does not decorate the handshake with modern fields", async () => {
    const result = resultOf(await serve().handle(request("initialize", {})));
    expect(result["resultType"]).toBeUndefined();
    expect(result["_meta"]).toBeUndefined();
  });

  it("sets the era for the plain requests that follow", async () => {
    const server = serve();
    await server.handle(request("initialize", { protocolVersion: "2025-06-18" }));
    const result = resultOf(await server.handle(request("tools/list", undefined, 2)));
    expect(result["resultType"]).toBeUndefined();
    expect(result["ttlMs"]).toBeUndefined();
  });
});

// ── Version rejection ─────────────────────────────────────────────────────────

describe("protocol version", () => {
  it("rejects an unknown version with the code MCP allocates, and says what it speaks", async () => {
    const response = await serve().handle(
      request("tools/list", { _meta: { [Meta.PROTOCOL_VERSION]: "1900-01-01" } }),
    );
    const error = errorOf(response);
    expect(error.code).toBe(RpcError.UNSUPPORTED_PROTOCOL_VERSION);
    expect(error.data).toEqual({ supported: [...SUPPORTED_VERSIONS], requested: "1900-01-01" });
  });

  it("never rejects server/discover on version — it is how a client finds out", async () => {
    const response = await serve().handle(
      request("server/discover", { _meta: { [Meta.PROTOCOL_VERSION]: "1900-01-01" } }),
    );
    expect(response && "result" in response).toBe(true);
  });

  it("treats a request declaring the modern version as modern whatever came before", async () => {
    const server = serve();
    await server.handle(request("initialize", { protocolVersion: "2025-06-18" }));
    const result = resultOf(await server.handle(modern("tools/list", {}, 2)));
    expect(result["resultType"]).toBe("complete");
  });
});

// ── tools/list ────────────────────────────────────────────────────────────────

describe("tools/list", () => {
  it("preserves registry order rather than sorting", async () => {
    const result = resultOf(await serve().handle(request("tools/list")));
    const names = (result["tools"] as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(["zulu", "alpha"]);
  });

  it("is byte-identical across calls, so a client can cache it", async () => {
    const server = serve();
    const first = JSON.stringify(resultOf(await server.handle(request("tools/list"))));
    const second = JSON.stringify(
      resultOf(await server.handle(request("tools/list", undefined, 2))),
    );
    expect(first).toBe(second);
  });

  it("publishes both schemas for every tool", async () => {
    const result = resultOf(await serve().handle(request("tools/list")));
    for (const listed of result["tools"] as Array<Record<string, unknown>>) {
      expect(listed["inputSchema"]).toBeDefined();
      expect(listed["outputSchema"]).toBeDefined();
      expect(typeof listed["description"]).toBe("string");
    }
  });

  it("carries the modern cache fields only in the modern era", async () => {
    const modernResult = resultOf(await serve().handle(modern("tools/list")));
    expect(modernResult["resultType"]).toBe("complete");
    expect(modernResult["ttlMs"]).toBeGreaterThan(0);
    // `private`: the answer describes this checkout and must not be served to
    // anyone else by a shared intermediary.
    expect(modernResult["cacheScope"]).toBe("private");
    expect((modernResult["_meta"] as Record<string, unknown>)[Meta.SERVER_INFO]).toEqual(identity);

    const legacyResult = resultOf(await serve().handle(request("tools/list")));
    expect(legacyResult["ttlMs"]).toBeUndefined();
    expect(legacyResult["cacheScope"]).toBeUndefined();
    expect(legacyResult["_meta"]).toBeUndefined();
  });
});

// ── tools/call ────────────────────────────────────────────────────────────────

describe("tools/call", () => {
  it("returns the tool's text as a content block", async () => {
    const result = resultOf(await serve().handle(request("tools/call", { name: "alpha" })));
    expect(result["content"]).toEqual([{ type: "text", text: "ran alpha" }]);
    expect(result["isError"]).toBe(false);
  });

  it("returns `data` as structuredContent, and omits the field when there is none", async () => {
    const withData = resultOf(await serve().handle(request("tools/call", { name: "zulu" })));
    expect(withData["structuredContent"]).toEqual({ which: "zulu" });

    const without = resultOf(await serve().handle(request("tools/call", { name: "alpha" })));
    expect("structuredContent" in without).toBe(false);
  });

  it("passes arguments through", async () => {
    let seen: Record<string, unknown> | undefined;
    const server = serve([
      tool({
        name: "echo",
        run: async (args) => {
          seen = args;
          return { text: "ok" };
        },
      }),
    ]);
    await server.handle(request("tools/call", { name: "echo", arguments: { q: "hello" } }));
    expect(seen).toEqual({ q: "hello" });
  });

  it("substitutes an empty object for arguments that are not one", async () => {
    let seen: unknown;
    const server = serve([
      tool({
        name: "echo",
        run: async (args) => {
          seen = args;
          return { text: "ok" };
        },
      }),
    ]);
    await server.handle(request("tools/call", { name: "echo", arguments: "not an object" }));
    expect(seen).toEqual({});
  });

  it("reports a tool that threw as isError, not as a protocol error", async () => {
    // The spec's reasoning, and the reason this matters: a model can read an
    // execution error and correct itself; a JSON-RPC error it usually cannot.
    const server = serve([
      tool({
        name: "boom",
        run: async () => {
          throw new Error("the database is not configured");
        },
      }),
    ]);
    const result = resultOf(await server.handle(request("tools/call", { name: "boom" })));
    expect(result["isError"]).toBe(true);
    expect(result["content"]).toEqual([{ type: "text", text: "the database is not configured" }]);
  });

  it("reports a declared failure as isError", async () => {
    const server = serve([
      tool({ name: "missing", run: async () => ({ text: "no such package", failed: true }) }),
    ]);
    const result = resultOf(await server.handle(request("tools/call", { name: "missing" })));
    expect(result["isError"]).toBe(true);
  });

  it("rejects an unknown tool with invalid params", async () => {
    const error = errorOf(await serve().handle(request("tools/call", { name: "nope" })));
    expect(error.code).toBe(RpcError.INVALID_PARAMS);
    expect(error.message).toContain("nope");
  });

  it("rejects a call with no name", async () => {
    const error = errorOf(await serve().handle(request("tools/call", {})));
    expect(error.code).toBe(RpcError.INVALID_PARAMS);
  });
});

// ── Cancellation ──────────────────────────────────────────────────────────────

describe("notifications/cancelled", () => {
  it("aborts the tool's signal and sends nothing further for that id", async () => {
    let aborted = false;
    const server = serve([
      tool({
        name: "slow",
        run: (_args, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve({ text: "stopped" });
            });
          }),
      }),
    ]);

    const call = server.handle(request("tools/call", { name: "slow" }, 7));
    // The notification has to land while the tool is running — which is the
    // reason the stdio loop dispatches concurrently rather than in lockstep.
    await Promise.resolve();
    await server.handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 7 },
    });

    expect(await call).toBeUndefined();
    expect(aborted).toBe(true);
  });

  it("ignores a cancellation for an id that is not in flight", async () => {
    const response = await serve().handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 999 },
    });
    expect(response).toBeUndefined();
  });
});

// ── Everything else ───────────────────────────────────────────────────────────

describe("other methods", () => {
  it("answers ping, because legacy clients send it", async () => {
    expect(resultOf(await serve().handle(request("ping")))).toEqual({});
  });

  it("returns method-not-found for anything it does not implement", async () => {
    const error = errorOf(await serve().handle(request("resources/list")));
    expect(error.code).toBe(RpcError.METHOD_NOT_FOUND);
  });

  it("never answers a notification, not even an unknown one", async () => {
    expect(
      await serve().handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeUndefined();
    expect(
      await serve().handle({ jsonrpc: "2.0", method: "notifications/unheard-of" }),
    ).toBeUndefined();
  });
});
