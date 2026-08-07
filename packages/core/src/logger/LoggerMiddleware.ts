import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware } from "../middleware/BaseMiddleware.ts";
import type { LogManager } from "./LogManager.ts";

// ANSI escape codes
const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[97m";

const METHOD_COLOR: Record<string, string> = {
  GET: BLUE,
  POST: GREEN,
  PUT: YELLOW,
  PATCH: MAGENTA,
  DELETE: RED,
  HEAD: DIM,
  OPTIONS: DIM,
};

function statusColor(s: number): string {
  if (s >= 500) return RED;
  if (s >= 400) return YELLOW;
  if (s >= 300) return CYAN;
  return GREEN;
}

function timeColor(ms: number): string {
  if (ms > 1000) return RED;
  if (ms > 300) return YELLOW;
  return DIM;
}

const LINE_WIDTH = 60;

export interface LoggerOptions {
  /** Output format. Defaults to LOG_FORMAT env var, then 'text'. */
  format?: "text" | "json";
}

/**
 * HTTP request logger — logs every request with timing and status.
 * Lives in @zerotal/core/logger so it routes output through the configured LogManager
 * channels (file, daily, etc.) rather than always writing to process.stdout.
 *
 * LogProvider automatically registers this middleware via useOnce() and wires
 * the LogManager via setManager() — no manual setup needed.
 *
 * @category Logging
 */
export class LoggerMiddleware extends BaseMiddleware<LoggerOptions> {
  protected options: LoggerOptions = {};

  private static _manager: LogManager | null = null;

  /** Called by LogProvider.onBooting() to wire the configured LogManager. */
  static setManager(mgr: LogManager): void {
    LoggerMiddleware._manager = mgr;
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const start = performance.now();

    await next();

    const ms = Math.round(performance.now() - start);
    const status = http.response?.status ?? 0;
    const method = http.request.method.toUpperCase();
    const path = http.url.pathname + (http.url.search || "");

    if (http.response) {
      http.response.headers.set("X-Request-Id", http.requestId);
    }

    const format =
      this.options.format ?? (Bun.env["LOG_FORMAT"] as "text" | "json" | undefined) ?? "text";

    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const context = {
      method,
      path,
      status,
      duration_ms: ms,
      request_id: http.requestId,
    };

    if (LoggerMiddleware._manager) {
      // Route through the configured logger channels (file, daily, etc.) regardless
      // of format — the channels own their own presentation.
      LoggerMiddleware._manager[level](`${method} ${path}`, context);
    } else if (format === "json") {
      // Fallback when no LogManager is wired (e.g. tests without LogProvider)
      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          ...context,
        }) + "\n",
      );
    } else {
      const mColor = METHOD_COLOR[method] ?? DIM;
      const sColor = statusColor(status);
      const tColor = timeColor(ms);

      const mStr = `${BOLD}${mColor}${method.padEnd(7)}${R}`;
      const dots =
        path.length < LINE_WIDTH ? " " + ".".repeat(LINE_WIDTH - path.length - 1) + " " : " ";
      const pStr = `${WHITE}${path}${R}${DIM}${dots}${R}`;
      const sStr = `${BOLD}${sColor}${status}${R}`;
      const tRaw = `${ms}ms`;
      const tStr = `${tColor}${tRaw.padStart(6)}${R}`;

      process.stdout.write(`  ${mStr} ${pStr}${sStr}  ${tStr}\n`);
    }

    return http.response;
  }
}
