import { describe, it, expect } from "bun:test";
import { serveStdio } from "./stdio.ts";
import { McpServer } from "./server.ts";
import type { ArchTool } from "./types.ts";

const identity = { name: "zerotal-arch", title: "Zerotal", version: "1.7.0" };

const echo: ArchTool = {
  name: "echo",
  title: "Echo",
  description: "returns what it was given",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  outputSchema: { type: "object" },
  run: async (args) => ({ text: String(args["text"] ?? ""), data: args }),
};

/** A byte stream over `text`, optionally split at arbitrary points. */
function stream(text: string, chunkSize = text.length): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

/** Drive the loop over `input` and return every frame it wrote, parsed. */
async function drive(
  input: string,
  chunkSize?: number,
  tools: ArchTool[] = [echo],
): Promise<{ frames: unknown[]; raw: string; logs: string[] }> {
  let raw = "";
  const logs: string[] = [];
  await serveStdio({
    server: new McpServer({ identity, tools }),
    input: stream(input, chunkSize),
    write: (frame) => {
      raw += frame;
    },
    log: (message) => logs.push(message),
  });
  const lines = raw.split("\n").filter((line) => line.length > 0);
  return { frames: lines.map((line) => JSON.parse(line) as unknown), raw, logs };
}

const line = (value: unknown): string => JSON.stringify(value) + "\n";

describe("serveStdio", () => {
  it("answers a request and returns when stdin ends", async () => {
    const { frames } = await drive(line({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ jsonrpc: "2.0", id: 1 });
  });

  it("writes nothing but parseable JSON, one message per line", async () => {
    // The invariant the whole design protects: this process never boots the
    // app, so nothing else can reach the sink. A single stray banner would
    // desync the client's line parser and corrupt every frame after it.
    const { raw } = await drive(
      line({ jsonrpc: "2.0", id: 1, method: "server/discover" }) +
        line({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
        line({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "one\ntwo\nthree" } },
        }),
    );

    const lines = raw.split("\n");
    expect(lines.pop()).toBe(""); // every frame is newline-terminated
    expect(lines).toHaveLength(3);
    for (const written of lines) expect(() => JSON.parse(written)).not.toThrow();
  });

  it("reassembles a message split across chunk boundaries", async () => {
    const { frames } = await drive(
      line({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      3, // three bytes at a time — every frame arrives in pieces
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 1 });
  });

  it("handles several messages arriving in one chunk", async () => {
    const { frames } = await drive(
      line({ jsonrpc: "2.0", id: 1, method: "ping" }) +
        line({ jsonrpc: "2.0", id: 2, method: "ping" }) +
        line({ jsonrpc: "2.0", id: 3, method: "ping" }),
    );
    expect(frames.map((f) => (f as { id: number }).id)).toEqual([1, 2, 3]);
  });

  it("reads a trailing line with no newline", async () => {
    const { frames } = await drive('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(frames).toHaveLength(1);
  });

  it("skips blank lines between messages", async () => {
    const { frames } = await drive("\n\n" + line({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
    expect(frames).toHaveLength(1);
  });

  it("answers a malformed line and keeps reading", async () => {
    const { frames } = await drive("{not json\n" + line({ jsonrpc: "2.0", id: 2, method: "ping" }));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(frames[1]).toMatchObject({ id: 2 });
  });

  it("writes nothing for a notification", async () => {
    const { raw } = await drive(line({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(raw).toBe("");
  });

  it("runs a full legacy session", async () => {
    const { frames } = await drive(
      line({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      }) +
        line({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        line({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
        line({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" } },
        }),
    );

    expect(frames).toHaveLength(3); // the notification is not answered
    expect(frames[0]).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    expect(frames[1]).toMatchObject({ result: {} });
    expect((frames[1] as { result: Record<string, unknown> }).result["resultType"]).toBeUndefined();
    expect(frames[2]).toMatchObject({ result: { content: [{ type: "text", text: "hi" }] } });
  });

  it("runs a full modern session, discover first", async () => {
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
    const { frames } = await drive(
      line({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } }) +
        line({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta } }) +
        line({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" }, _meta: meta },
        }),
    );

    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ result: { resultType: "complete" } });
    expect(frames[1]).toMatchObject({ result: { resultType: "complete", cacheScope: "private" } });
    expect(frames[2]).toMatchObject({ result: { resultType: "complete", isError: false } });
  });

  it("dispatches concurrently, so a cancellation can reach a running tool", async () => {
    let release = (): void => {};
    const slow: ArchTool = {
      ...echo,
      name: "slow",
      run: (_args, signal) =>
        new Promise((resolve) => {
          release = () => resolve({ text: "finished" });
          signal.addEventListener("abort", () => resolve({ text: "stopped" }));
        }),
    };

    const pending = drive(
      line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "slow" } }) +
        line({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }),
      undefined,
      [slow],
    );

    const { frames } = await pending;
    release();
    // Cancelled: the spec forbids sending anything further for that id.
    expect(frames).toHaveLength(0);
  });
});
