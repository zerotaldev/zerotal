import { describe, it, expect } from "bun:test";
import { decodeFrame, encodeFrame, failure, success } from "./jsonrpc.ts";
import { RpcError } from "./types.ts";

describe("decodeFrame", () => {
  it("reads a request", () => {
    const decoded = decodeFrame('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(decoded).toEqual({
      ok: true,
      request: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
  });

  it("reads a notification as a request with no id", () => {
    const decoded = decodeFrame('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(decoded?.ok).toBe(true);
    expect(decoded?.ok === true && decoded.request.id).toBeUndefined();
  });

  it("keeps object params and drops non-object ones", () => {
    const withObject = decodeFrame('{"jsonrpc":"2.0","id":1,"method":"m","params":{"a":1}}');
    expect(withObject?.ok === true && withObject.request.params).toEqual({ a: 1 });

    // JSON-RPC allows positional params; MCP never uses them, and carrying an
    // array through as if it were a params object would fail further in.
    const withArray = decodeFrame('{"jsonrpc":"2.0","id":1,"method":"m","params":[1,2]}');
    expect(withArray?.ok === true && withArray.request.params).toBeUndefined();
  });

  it("ignores blank lines rather than answering them", () => {
    expect(decodeFrame("")).toBeUndefined();
    expect(decodeFrame("   \t ")).toBeUndefined();
  });

  const rejections: Array<[label: string, line: string, code: number, id: unknown]> = [
    ["malformed JSON", "{not json", RpcError.PARSE, null],
    ["a batch", '[{"jsonrpc":"2.0","id":1,"method":"m"}]', RpcError.INVALID_REQUEST, null],
    ["a bare scalar", '"hello"', RpcError.INVALID_REQUEST, null],
    ["a missing version", '{"id":1,"method":"m"}', RpcError.INVALID_REQUEST, 1],
    ["a wrong version", '{"jsonrpc":"1.0","id":1,"method":"m"}', RpcError.INVALID_REQUEST, 1],
    ["a missing method", '{"jsonrpc":"2.0","id":1}', RpcError.INVALID_REQUEST, 1],
    ["an empty method", '{"jsonrpc":"2.0","id":1,"method":""}', RpcError.INVALID_REQUEST, 1],
  ];

  for (const [label, line, code, id] of rejections) {
    it(`rejects ${label}`, () => {
      const decoded = decodeFrame(line);
      expect(decoded?.ok).toBe(false);
      expect(decoded?.ok === false && decoded.failure.error.code).toBe(code);
      expect(decoded?.ok === false && decoded.failure.id).toBe(id as never);
    });
  }

  it("keeps the id on a rejection so the client can correlate it", () => {
    const decoded = decodeFrame('{"jsonrpc":"2.0","id":"abc","method":42}');
    expect(decoded?.ok === false && decoded.failure.id).toBe("abc");
  });

  it("drops an id that JSON-RPC does not allow", () => {
    const decoded = decodeFrame('{"jsonrpc":"1.0","id":{"nested":true},"method":"m"}');
    expect(decoded?.ok === false && decoded.failure.id).toBeNull();
  });
});

describe("encodeFrame", () => {
  it("emits one line, newline-terminated", () => {
    const frame = encodeFrame(success(1, { ok: true }));
    expect(frame).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
  });

  it("escapes newlines inside strings rather than emitting them", () => {
    // The stdio binding's hard rule: a message MUST NOT contain an embedded
    // newline. A tool result carrying a stack trace is the everyday case.
    const frame = encodeFrame(success(1, { text: "line one\nline two\r\nline three" }));
    expect(frame.split("\n")).toHaveLength(2);
    expect(frame.endsWith("\n")).toBe(true);
    expect(JSON.parse(frame)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { text: "line one\nline two\r\nline three" },
    });
  });

  it("omits `data` when there is none", () => {
    expect(JSON.parse(encodeFrame(failure(1, RpcError.INTERNAL, "boom")))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: RpcError.INTERNAL, message: "boom" },
    });
  });

  it("carries `data` when there is", () => {
    const parsed = JSON.parse(
      encodeFrame(failure(1, RpcError.UNSUPPORTED_PROTOCOL_VERSION, "nope", { supported: ["x"] })),
    ) as { error: { data: unknown } };
    expect(parsed.error.data).toEqual({ supported: ["x"] });
  });
});
