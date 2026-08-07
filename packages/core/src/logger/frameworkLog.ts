/**
 * The logger framework internals use, so their output goes wherever the app's
 * logging config sends it instead of straight to the terminal.
 *
 * Framework code runs at moments application code never does — during boot,
 * inside a CLI command with no application, in a package used standalone — so
 * it cannot reach for the `Log` facade, which throws when the container has no
 * logger. This resolves the real logger when there is one and formats to the
 * console identically when there is not, so a line looks the same either side
 * of boot.
 */
import os from "node:os";
import { tryCurrentApp } from "../application/currentApp.ts";
import { ConsoleChannel } from "./channels/ConsoleChannel.ts";
import type { BoundLogger, LogEntry, LogLevel } from "./types.ts";
import type { LogManager } from "./LogManager.ts";

/** Pre-boot output goes through the same renderer, so the format never changes. */
const _fallbackChannel = new ConsoleChannel("pretty");

let _hostname: string | undefined;

/**
 * A logger tagged with the subsystem it belongs to.
 *
 * Resolve it per call rather than caching: a module-level logger would capture
 * whichever application existed at import time, which in tests is the previous
 * one and in a CLI is none at all.
 *
 * @param scope - Subsystem name, rendered as `[FLOW]` by the console channel.
 *
 * @example
 * ```ts
 * frameworkLog("flow").info("Compiled 4 page(s)", { ms: 76 });
 * ```
 *
 * @internal
 */
export function frameworkLog(scope: string): BoundLogger {
  const manager = _tryManager();
  if (manager) return manager.scope(scope);

  const emit =
    (level: LogLevel) =>
    (message: string, context?: Record<string, unknown>, err?: unknown): void => {
      _fallbackChannel.write(_entry(level, scope, message, context, err)).catch(() => {
        // Logging must never throw into the code that called it.
      });
    };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    fatal: emit("fatal"),
    table: (message, rows, level = "info"): void => {
      const context = Array.isArray(rows) ? { rows } : (rows as Record<string, unknown>);
      const entry = { ..._entry(level, scope, message, context), display: "table" as const };
      _fallbackChannel.write(entry).catch(() => {});
    },
  };
}

/** The container's logger, or undefined when there is no application or no binding. */
function _tryManager(): LogManager | undefined {
  return tryCurrentApp()?.container.tryMake("log") as LogManager | undefined;
}

function _entry(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>,
  err?: unknown,
): LogEntry {
  _hostname ??= os.hostname();
  const entry: LogEntry = {
    level,
    channel: "console",
    scope,
    message,
    timestamp: new Date().toISOString(),
    hostname: _hostname,
    pid: process.pid,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
  if (err !== undefined) {
    entry.error = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.stack) entry.stack = err.stack;
  }
  return entry;
}
