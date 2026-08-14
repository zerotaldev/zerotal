import { AiCancelledError, AiRequestError } from "../errors.ts";

/**
 * Read a `text/event-stream` body, yielding each event's `data:` payload.
 *
 * Frames do not align with chunks — a single `read()` can hand back half an
 * event, or three of them — so the buffer is split on the blank-line terminator
 * rather than per chunk. Getting that wrong produces a stream that works on a
 * fast localhost and drops tokens over a real network.
 *
 * @internal
 */
export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const body = response.body;
  if (!body)
    throw new AiRequestError("The provider returned a streaming response with no body.", 0);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) throw new AiCancelledError();

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = dataOf(frame);
        if (data !== undefined) yield data;

        boundary = buffer.indexOf("\n\n");
      }
    }

    // A final frame with no trailing blank line still carries an event.
    const tail = dataOf(buffer);
    if (tail !== undefined) yield tail;
  } finally {
    // Releasing matters on the abort path: the response body stays open until
    // the reader lets go, and an abandoned stream holds the socket.
    reader.releaseLock();
    if (!response.bodyUsed) await body.cancel().catch(() => undefined);
  }
}

/** The concatenated `data:` lines of one frame, or `undefined` for a comment. */
function dataOf(frame: string): string | undefined {
  const lines = frame.split("\n");
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  return data.length > 0 ? data.join("\n") : undefined;
}

/**
 * Read a newline-delimited JSON body, yielding each line. Ollama's stream format.
 *
 * @internal
 */
export async function* readNdjson(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const body = response.body;
  if (!body)
    throw new AiRequestError("The provider returned a streaming response with no body.", 0);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) throw new AiCancelledError();

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
        newline = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
    if (!response.bodyUsed) await body.cancel().catch(() => undefined);
  }
}
