/**
 * Structured, channel-based logging for Zerotal applications.
 *
 * A single {@link LogManager} owns a set of named {@link LogChannel | channels}
 * (console, single file, date-rotated `daily` files, `null`, or a `stack` that
 * fans out to several at once) and routes every {@link LogEntry} to the channel
 * you select. Entries are enriched automatically with hostname, pid, app/env,
 * and the active request id, and each channel has its own minimum
 * {@link LogLevel}. Reach the container-bound manager through the {@link Log}
 * facade; configure it with {@link LoggingConfig}.
 *
 * @example
 * ```ts
 * import { Log } from "@zerotal/core/logger";
 *
 * // Log at any of the five levels on the default channel.
 * Log.info("User signed in", { userId: 42 });
 * Log.error("Payment failed", { orderId: 99 }, err);
 *
 * // Bind shared context, or target a specific channel.
 * Log.withContext({ requestId: "abc" }).warn("Retrying");
 * Log.channel("daily").info("Written to today's file");
 * ```
 *
 * @example
 * ```ts
 * // config/logging.ts — a "stack" that writes to both console and daily files.
 * import { LoggingConfig } from "@zerotal/core/logger";
 *
 * export default LoggingConfig({
 *   default: "stack",
 *   channels: {
 *     stack: { driver: "stack", channels: ["console", "daily"] },
 *     console: { driver: "console", format: "pretty" },
 *     daily: { driver: "daily", path: "./storage/logs", days: 14, level: "info" },
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

export { Log } from "./Log.ts";
export { LogManager } from "./LogManager.ts";
export { frameworkLog } from "./frameworkLog.ts";
export { LogProvider } from "../provider/LogProvider.ts";
export { LoggingConfig } from "./config.ts";

export { NullChannel } from "./channels/NullChannel.ts";
export { StackChannel } from "./channels/StackChannel.ts";
export { ConsoleChannel } from "./channels/ConsoleChannel.ts";
export { SingleChannel } from "./channels/SingleChannel.ts";
export { DailyChannel } from "./channels/DailyChannel.ts";

export { LoggerMiddleware } from "./LoggerMiddleware.ts";
export type { LoggerOptions } from "./LoggerMiddleware.ts";

export { renderTable } from "./renderTable.ts";
export type { TableData } from "./renderTable.ts";

export type {
  LogLevel,
  LogEntry,
  LogChannel,
  BoundLogger,
  ChannelConfig,
  LoggingConfigShape,
} from "./types.ts";
