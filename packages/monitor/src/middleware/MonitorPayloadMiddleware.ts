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
      if (http.response) resBody = await http.response.clone().text();
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
