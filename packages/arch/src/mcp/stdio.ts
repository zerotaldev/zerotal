/**
 * The stdio binding: read newline-delimited JSON-RPC from stdin, write replies
 * to stdout.
 *
 * ## Two rules this file exists to keep
 *
 * **Nothing but MCP frames reaches stdout.** The spec states it as a MUST NOT,
 * and the failure mode is not a warning — a stray banner on stdout desyncs the
 * client's line parser and every frame after it is garbage. Diagnostics go to
 * stderr, which the spec explicitly allows and clients are told not to read as
 * failure.
 *
 * **Requests are dispatched concurrently, not in lockstep.** Awaiting each
 * request before reading the next would make `notifications/cancelled`
 * unreachable: the cancellation for a running tool is by definition sent while
 * that tool is still running. Each frame is written in a single call, so replies
 * may interleave in time but never within a message.
 *
 * The loop ends when stdin reaches EOF. That is the only portable shutdown
 * signal — the spec names closing stdin as the primary one, and on Windows
 * there is no POSIX signal to fall back to.
 */
import { decodeFrame, encodeFrame } from "./jsonrpc.ts";
import type { McpServer } from "./server.ts";
import type { JsonRpcResponse } from "./types.ts";

export interface StdioOptions {
  server: McpServer;
  /** Byte source. Defaults to this process's stdin. */
  input?: ReadableStream<Uint8Array>;
  /** Frame sink. Defaults to this process's stdout. Injected in tests. */
  write?: (frame: string) => void;
  /** Diagnostics sink. Defaults to stderr — never stdout. */
  log?: (message: string) => void;
}

/**
 * Serve MCP over a byte stream until it ends.
 *
 * Resolves once the input is exhausted *and* every request still in flight has
 * been answered, so a caller can exit the process knowing nothing is pending.
 */
export async function serveStdio(options: StdioOptions): Promise<void> {
  const { server } = options;
  const input = options.input ?? Bun.stdin.stream();
  const write = options.write ?? ((frame: string) => void process.stdout.write(frame));
  const log = options.log ?? ((message: string) => void process.stderr.write(message + "\n"));

  const decoder = new TextDecoder();
  const pending = new Set<Promise<void>>();
  let buffer = "";

  const dispatch = (line: string): void => {
    const decoded = decodeFrame(line);
    if (decoded === undefined) return;
    if (!decoded.ok) {
      send(decoded.failure);
      return;
    }

    const task = server
      .handle(decoded.request)
      .then((response) => {
        if (response !== undefined) send(response);
      })
      .catch((error: unknown) => {
        // Reaching here means the dispatcher itself failed, not a tool — tools
        // have their own catch. There is no useful reply to send for it, so the
        // honest thing is to say so on stderr and keep serving.
        log(`[arch] dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        pending.delete(task);
      });

    pending.add(task);
  };

  const send = (response: JsonRpcResponse): void => {
    try {
      write(encodeFrame(response));
    } catch (error) {
      log(`[arch] could not encode a reply: ${error instanceof Error ? error.message : error}`);
    }
  };

  // Read through the reader rather than `for await`: Bun's streams are async
  // iterable at runtime, but the DOM `ReadableStream` type this repo compiles
  // against does not declare it, and the alternative is a cast in the one file
  // whose whole job is to be trustworthy.
  const reader = input.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      dispatch(line);
      newline = buffer.indexOf("\n");
    }
  }

  // A final line with no trailing newline is still a message. Clients should not
  // send one, but a shell heredoc or a hand-written fixture will.
  if (buffer.trim().length > 0) dispatch(buffer);

  while (pending.size > 0) await Promise.all([...pending]);
}
