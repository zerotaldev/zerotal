/**
 * Captures request/response headers and bodies for the request trace (Telescope's
 * payload watcher). Opt-in via `capturePayloads` — the provider registers it
 * globally only when enabled. Bodies are read from clones so the handler still gets
 * the originals, and sensitive headers/keys are redacted before anything is stored.
 */
import type { Pipe, NextFn, HttpContext } from "@zerotal/core";
import { currentApp } from "@zerotal/core";
import { addPayload } from "../recorder/ctxBuffers.ts";
import type { ResolvedMonitorConfig } from "../config.ts";

const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);
const REDACT_KEY = /pass(word)?|token|secret|api[-_]?key|authorization|credit[-_]?card|cvv/i;
const REDACTED = "[redacted]";

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = REDACT_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  });
  return out;
}

/** Recursively mask values of sensitive keys when the body parses as JSON. */
function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY.test(k) ? REDACTED : redactJson(v);
    }
    return out;
  }
  return value;
}

function clip(s: string, maxBytes: number): string {
  return s.length > maxBytes ? `${s.slice(0, maxBytes)}…(truncated)` : s;
}

function redactBody(raw: string, maxBytes: number): string {
  if (!raw) return "";
  try {
    return clip(JSON.stringify(redactJson(JSON.parse(raw))), maxBytes);
  } catch {
    return clip(raw, maxBytes); // not JSON — keep raw, just truncated
  }
}

/** How many reads {@link capturableBody} makes before it stops waiting for a body to end. */
const READ_LIMIT = 256;

/**
 * The response body as text, read from a clone, when the whole of it is there now; `null` for a
 * body still arriving.
 *
 * The response is not handed on until this returns, so waiting for a body that has not finished
 * holds the request: an event stream never finishes, and its `GET` (and `HEAD`) hung for as long
 * as the stream lived. An event stream is not read at all. Any other body is read for as long as
 * its reads settle before the next turn of the event loop, which a body held in memory (a string,
 * JSON, rendered HTML) always does; a stream that is still producing is left to the client, and
 * the clone is cancelled, which leaves the original to the client.
 */
async function capturableBody(response: Response): Promise<string | null> {
  if ((response.headers.get("Content-Type") ?? "").startsWith("text/event-stream")) return null;
  const body = response.clone().body;
  if (body === null) return "";
  const reader = body.getReader();
  let late = false;
  const nextTurn = new Promise<null>((resolve) =>
    setImmediate(() => {
      late = true;
      resolve(null);
    }),
  );
  const read = async (): Promise<string | null> => {
    const decoder = new TextDecoder();
    let text = "";
    for (let reads = 0; reads < READ_LIMIT && !late; reads++) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
    return null;
  };
  const text = await Promise.race([read().catch(() => null), nextTurn]);
  // Not awaited: cancelling one branch of a clone settles only once the other branch, the one
  // the client is still reading, is cancelled too.
  if (text === null) void reader.cancel().catch(() => {});
  return text;
}

export class MonitorPayloadMiddleware implements Pipe<HttpContext> {
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    let maxBytes = 65536;
    let monitorPath = "/monitor";
    try {
      const cfg = currentApp().container.makeSync("monitor") as ResolvedMonitorConfig;
      maxBytes = cfg.payloadMaxBytes;
      monitorPath = cfg.path;
    } catch {
      /* config not ready — use defaults */
    }

    // Don't capture the panel's own traffic or framework internals.
    const path = http.url.pathname;
    if (path.startsWith(monitorPath) || path.startsWith("/metrics") || path.startsWith("/__")) {
      return next();
    }

    // Request body from a clone so the handler can still read the original. Skip huge
    // bodies (best-effort via content-length) to avoid buffering large uploads.
    let reqBody = "";
    try {
      const len = Number(http.request.headers.get("content-length") ?? 0);
      if (http.request.body && len <= maxBytes * 16) reqBody = await http.request.clone().text();
    } catch {
      /* unreadable / streamed body — skip */
    }
    const reqHeaders = redactHeaders(http.request.headers);

    const result = await next();

    let resBody = "";
    try {
      if (http.response) resBody = (await capturableBody(http.response)) ?? "";
    } catch {
      /* streamed / binary response — skip */
    }

    addPayload(http, {
      reqHeaders,
      reqBody: redactBody(reqBody, maxBytes),
      resBody: clip(resBody, maxBytes),
    });

    return result;
  }
}
