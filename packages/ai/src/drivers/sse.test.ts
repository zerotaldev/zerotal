/**
 * The stream parsers, tested against framing rather than against a happy path.
 *
 * These read a remote provider's bytes off the network, which is the input that
 * changes without telling you, and frames do not align with chunks. A parser that
 * assumes they do works on a fast localhost and drops tokens over a real network —
 * a failure that looks like the model being terse rather than like a bug.
 */
import { describe, it, expect } from "bun:test";
import { readSse, readNdjson } from "./sse.ts";
import { AiCancelledError, AiRequestError } from "../errors.ts";

/** A Response whose body arrives as the given chunks, exactly as split. */
function streaming(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("readSse — framing", () => {
  it("reads several events out of one chunk", async () => {
    const body = streaming(["data: one\n\ndata: two\n\ndata: three\n\n"]);
    expect(await collect(readSse(body))).toEqual(["one", "two", "three"]);
  });

  it("reassembles an event split across two chunks", async () => {
    // The case that works on localhost and fails on a real network.
    const body = streaming(["data: hel", "lo\n\n"]);
    expect(await collect(readSse(body))).toEqual(["hello"]);
  });

  it("reassembles an event whose terminator is split across chunks", async () => {
    // The blank line itself arriving in two pieces is the nastiest version: a
    // parser matching "\n\n" inside a single chunk never sees it.
    const body = streaming(["data: hello\n", "\ndata: world\n\n"]);
    expect(await collect(readSse(body))).toEqual(["hello", "world"]);
  });

  it("reassembles a payload split mid-multi-byte-character", async () => {
    // A UTF-8 sequence cut across a chunk boundary is why the decoder is
    // constructed with { stream: true }; without it this yields a replacement char.
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: café\n\n");
    const split = 9; // lands inside the é
    const body = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      }),
    );

    expect(await collect(readSse(body))).toEqual(["café"]);
  });

  it("yields a final event that has no trailing blank line", async () => {
    // A stream that ends without its terminator still carried an event, and
    // dropping it loses the last token of every such response.
    const body = streaming(["data: one\n\ndata: last"]);
    expect(await collect(readSse(body))).toEqual(["one", "last"]);
  });

  it("joins multiple data lines within one frame", async () => {
    const body = streaming(["data: first\ndata: second\n\n"]);
    expect(await collect(readSse(body))).toEqual(["first\nsecond"]);
  });

  it("ignores an event type line and keeps its data", async () => {
    const body = streaming(["event: message_delta\ndata: payload\n\n"]);
    expect(await collect(readSse(body))).toEqual(["payload"]);
  });

  it("skips a comment-only frame rather than yielding an empty string", async () => {
    // Providers send `: keep-alive` pings. Yielding "" for one makes every
    // consumer handle a chunk that means nothing.
    const body = streaming([": keep-alive\n\ndata: real\n\n"]);
    expect(await collect(readSse(body))).toEqual(["real"]);
  });

  it("passes a [DONE] sentinel through for the caller to interpret", async () => {
    // The parser's job is framing, not protocol. Whether [DONE] ends the stream
    // is the driver's decision, and each provider spells it differently.
    const body = streaming(["data: {}\n\ndata: [DONE]\n\n"]);
    expect(await collect(readSse(body))).toEqual(["{}", "[DONE]"]);
  });

  it("does not try to parse the payload", async () => {
    // Malformed JSON is the driver's problem; a parser that throws here would
    // turn one bad frame into a dead stream.
    const body = streaming(["data: {not json\n\n"]);
    expect(await collect(readSse(body))).toEqual(["{not json"]);
  });

  it("yields nothing for an empty body rather than hanging", async () => {
    expect(await collect(readSse(streaming([])))).toEqual([]);
  });
});

describe("readSse — failure paths", () => {
  it("names the problem when there is no body at all", async () => {
    const bodiless = new Response(null, { status: 200 });
    await expect(collect(readSse(bodiless))).rejects.toThrow(AiRequestError);
  });

  it("stops on an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = streaming(["data: one\n\n"]);

    await expect(collect(readSse(body, controller.signal))).rejects.toThrow(AiCancelledError);
  });

  it("releases the body when the consumer stops early", async () => {
    // An abandoned stream holds the socket. Breaking out of a for-await runs the
    // generator's finally, which is the only thing that lets go.
    const body = streaming(["data: one\n\ndata: two\n\n"]);
    for await (const _first of readSse(body)) break;

    // Nothing to assert but the absence of a hang or an unhandled rejection; the
    // release is what this exercises.
    expect(true).toBe(true);
  });
});

describe("readNdjson", () => {
  it("yields one line per object", async () => {
    const body = streaming(['{"a":1}\n{"a":2}\n']);
    expect(await collect(readNdjson(body))).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("reassembles a line split across chunks", async () => {
    const body = streaming(['{"a"', ":1}\n"]);
    expect(await collect(readNdjson(body))).toEqual(['{"a":1}']);
  });

  it("yields a final line with no trailing newline", async () => {
    const body = streaming(['{"a":1}']);
    expect(await collect(readNdjson(body))).toEqual(['{"a":1}']);
  });

  it("skips blank lines", async () => {
    const body = streaming(['{"a":1}\n\n\n{"a":2}\n']);
    expect(await collect(readNdjson(body))).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("stops on an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(readNdjson(streaming(['{"a":1}\n']), controller.signal))).rejects.toThrow(
      AiCancelledError,
    );
  });
});
