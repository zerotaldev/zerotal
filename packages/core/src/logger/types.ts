import type { TableData } from "./renderTable.ts";

export type { TableData };

/**
 * Severity of a log entry, from lowest to highest: `debug`, `info`, `warn`,
 * `error`, `fatal`. A channel's configured minimum level suppresses any entry
 * below it.
 *
 * @category Logging
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Numeric rank of each {@link LogLevel}, used to compare an entry's level
 * against a channel's minimum. Higher means more severe.
 *
 * @internal
 */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * A single fully-enriched log record as it is handed to a {@link LogChannel}.
 *
 * The {@link LogManager} populates `timestamp`, `hostname`, and `pid` on every
 * entry; `app`, `env`, `requestId`, `context`, `error`, and `stack` appear only
 * when the corresponding data is available.
 *
 * @category Logging
 */
export interface LogEntry {
  /** Severity the entry was emitted at. */
  level: LogLevel;
  /** Name of the channel the entry was routed to. */
  channel: string;
  /**
   * Subsystem that emitted the entry — `app`, `flow`, `inertia`, `queue`.
   * Rendered as a `[SCOPE]` tag by the console channel and kept as a field by
   * the file/JSON ones, so a log file can be filtered by source.
   */
  scope?: string | undefined;
  /** Human-readable log message. */
  message: string;
  /** ISO-8601 timestamp of when the entry was created. */
  timestamp: string;
  /** Application name, from `app.name` config, when configured. */
  app?: string | undefined;
  /** Application environment, from `app.env` config, when configured. */
  env?: string | undefined;
  /** Host machine name (`os.hostname()`). */
  hostname: string;
  /** Process id of the emitting process. */
  pid: number;
  /** Id of the active HTTP request, when logging inside a request context. */
  requestId?: string | undefined;
  /** Arbitrary structured context passed at the call site (omitted when empty). */
  context?: Record<string, unknown> | undefined;
  /**
   * How a human-facing channel should present {@link LogEntry.context}. `"table"`
   * asks the console for box-drawn columns; file and JSON channels ignore it and
   * keep writing the same structured data. Purely a rendering hint — never a
   * change to what the entry contains.
   */
  display?: "table" | undefined;
  /** Error message, when an error/value was passed to the log call. */
  error?: string | undefined;
  /** Stack trace, when the passed value was an `Error` with a stack. */
  stack?: string | undefined;
}

/**
 * Contract every log destination implements: a single async `write` that
 * persists or displays one {@link LogEntry}. Implementations include
 * {@link ConsoleChannel}, {@link SingleChannel}, {@link DailyChannel},
 * {@link StackChannel}, and {@link NullChannel}. Implement this to add a custom
 * destination.
 *
 * @category Channels
 */
export interface LogChannel {
  write(entry: LogEntry): Promise<void>;
}

/**
 * A logger pinned to a specific channel and/or a fixed context bag.
 *
 * Returned by {@link LogManager.channel} and {@link LogManager.withContext}
 * (and implemented by {@link LogManager} itself for the default channel). Each
 * level method takes a `message`, optional structured `context`, and an
 * optional error/value whose message and stack are captured onto the entry.
 *
 * @category Context
 */
export interface BoundLogger {
  debug(message: string, context?: Record<string, unknown>, err?: unknown): void;
  info(message: string, context?: Record<string, unknown>, err?: unknown): void;
  warn(message: string, context?: Record<string, unknown>, err?: unknown): void;
  error(message: string, context?: Record<string, unknown>, err?: unknown): void;
  fatal(message: string, context?: Record<string, unknown>, err?: unknown): void;
  /**
   * Log `message` with `rows` attached, asking human-facing channels to render
   * them as a table. The data is ordinary context, so a JSON or file channel
   * records exactly what the other level methods would have recorded.
   *
   * @param rows  One object (key/value rows) or a list of objects (columns).
   * @param level Severity to emit at. Defaults to `info`.
   */
  table(message: string, rows: TableData, level?: LogLevel): void;
}

/**
 * Discriminated union describing one channel's configuration, keyed by
 * `driver`. Each variant maps to a concrete {@link LogChannel}:
 *
 * - `console` — {@link ConsoleChannel}; `format` is `"pretty"` (default) or `"json"`.
 * - `single` — {@link SingleChannel}; appends every entry to `path`.
 * - `daily` — {@link DailyChannel}; date-rotated files under `path`, pruned after `days`.
 * - `stack` — {@link StackChannel}; fans out to the named `channels`.
 * - `null` — {@link NullChannel}; discards everything.
 *
 * @category Channels
 */
export type ChannelConfig =
  | { driver: "console"; level?: LogLevel; format?: "json" | "pretty" }
  | { driver: "single"; level?: LogLevel; path: string }
  | { driver: "daily"; level?: LogLevel; path: string; days?: number }
  | { driver: "stack"; level?: LogLevel; channels: string[] }
  | { driver: "null" };

/**
 * The always-on terminal sink. Every entry is printed unless this is `false`.
 *
 * Console output is a property of the logger rather than a channel you route
 * to, so pointing `default` at a file channel no longer costs you the terminal.
 *
 * @category Configuration
 */
export type ConsoleSinkConfig =
  | false
  | {
      /** Minimum level printed. Defaults to `debug`. */
      level?: LogLevel;
      /** `"pretty"` (default) or `"json"`. */
      format?: "json" | "pretty";
    };

/**
 * The always-on file trail. Every entry is appended to a date-rotated file
 * unless this is `false`.
 *
 * This is the record you read when the terminal is gone: after the process
 * exited, after the scrollback rolled over, on a machine you were not watching.
 * It is deliberately independent of {@link ConsoleSinkConfig} — quietening the
 * terminal must not cost you the trail.
 *
 * @category Configuration
 */
export type FileSinkConfig =
  | false
  | {
      /** Directory holding the per-day files. Defaults to `./storage/logs`. */
      path?: string;
      /** Days a file survives before being pruned. Defaults to `14`. */
      days?: number;
      /**
       * Minimum level written. Defaults to `debug` — the trail records
       * everything, and the console threshold controls what you actually watch.
       */
      level?: LogLevel;
    };

/**
 * Full shape of the `logging` config namespace, as produced by
 * {@link LoggingConfig}. Defines the two always-on sinks, the channel map,
 * which channel is the default, and framework logging thresholds.
 *
 * @category Configuration
 */
export interface LoggingConfigShape {
  /**
   * The terminal sink, on unless `false`. See {@link ConsoleSinkConfig}.
   */
  console?: ConsoleSinkConfig;
  /**
   * The durable file trail, on unless `false`. See {@link FileSinkConfig}.
   */
  file?: FileSinkConfig;
  /** Name of the channel used by unqualified `Log.*` calls. */
  default: string;
  /**
   * Named channel definitions; see {@link ChannelConfig}.
   *
   * Channels are *additional* destinations, not replacements — an entry routed
   * to one still reaches the console and the file trail. A channel that already
   * covers a sink (a `console` driver, or `single`/`daily`) suppresses that
   * baseline for its own entries, so nothing is written twice.
   */
  channels: Record<string, ChannelConfig>;
  /** Threshold, in ms, above which ORM queries are logged as slow (default 1000). */
  slowQueryMs?: number;
  /**
   * Log every HTTP request (method, path, status, duration) via `LoggerMiddleware`.
   * On by default; set `false` to silence the per-request access log.
   */
  requests?: boolean;
}
