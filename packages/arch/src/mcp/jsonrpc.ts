/**
 * JSON-RPC 2.0 framing for the stdio binding.
 *
 * The wire format is one JSON message per line, and the spec states the
 * constraint as a hard MUST NOT: a message may not contain an embedded newline.
 * `JSON.stringify` already escapes newlines inside strings, so the rule holds by
 * construction — {@link encodeFrame} asserts it anyway, because the one thing
 * that must never happen here is a half-message splitting a client's parser and
 * desynchronising every frame after it.
 *
 * Decoding never throws. A line that is not JSON, or is JSON but not a request,
 * comes back as a ready-to-send failure rather than an exception — a malformed
 * frame is a thing to answer, not a reason for the server to stop reading.
 */
import { RpcError } from "./types.ts";
import type { JsonRpcFailure, JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "./types.ts";

/** The result of reading one line: either a request to dispatch, or a reply to send. */
export type DecodedFrame =
  { ok: true; request: JsonRpcRequest } | { ok: false; failure: JsonRpcFailure };

/** Build a JSON-RPC success reply. */
export function success(id: JsonRpcId, result: Record<string, unknown>): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Build a JSON-RPC error reply.
 *
 * `id` is `null` only when the inbound frame was too broken to carry one — that
 * is the one case JSON-RPC allows it, and conflating it with a real id would
 * make a client correlate the failure to the wrong request.
 */
export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An id is usable if JSON-RPC allows it there: a string or a number, never anything else. */
function readId(value: unknown): JsonRpcId | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Turn one line of input into a request, or into the failure to answer it with.
 *
 * Blank lines return `undefined` — clients and shells both emit them, and
 * answering a blank line with a parse error would be noise rather than help.
 */
export function decodeFrame(line: string): DecodedFrame | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, failure: failure(null, RpcError.PARSE, "Invalid JSON.") };
  }

  // Batches were never part of the stdio binding's message rules — one message
  // per line — and the modern revision does not reinstate them.
  if (Array.isArray(parsed)) {
    return {
      ok: false,
      failure: failure(null, RpcError.INVALID_REQUEST, "Batched requests are not supported."),
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      failure: failure(null, RpcError.INVALID_REQUEST, "A message must be a JSON object."),
    };
  }

  const id = readId(parsed["id"]);
  if (parsed["jsonrpc"] !== "2.0") {
    return {
      ok: false,
      failure: failure(id ?? null, RpcError.INVALID_REQUEST, 'Expected "jsonrpc": "2.0".'),
    };
  }

  const method = parsed["method"];
  if (typeof method !== "string" || method.length === 0) {
    return {
      ok: false,
      failure: failure(id ?? null, RpcError.INVALID_REQUEST, "Missing method."),
    };
  }

  const rawParams = parsed["params"];
  const params = isPlainObject(rawParams) ? rawParams : undefined;

  return {
    ok: true,
    request: {
      jsonrpc: "2.0",
      method,
      ...(id !== undefined ? { id } : {}),
      ...(params !== undefined ? { params } : {}),
    },
  };
}

/**
 * Serialise one message to its wire line, newline included.
 *
 * @throws If the encoded form contains a raw newline. Unreachable through
 *   `JSON.stringify`, and asserted rather than trusted because a frame that
 *   splits across two lines corrupts the stream from that point on.
 */
export function encodeFrame(message: JsonRpcResponse): string {
  const encoded = JSON.stringify(message);
  if (encoded.includes("\n") || encoded.includes("\r")) {
    throw new Error("Encoded JSON-RPC frame contains a newline.");
  }
  return encoded + "\n";
}
