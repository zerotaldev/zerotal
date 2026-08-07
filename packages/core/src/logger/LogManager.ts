import os from "node:os";
import { RequestContext } from "../context/RequestContext.ts";
import type {
  LogChannel,
  LogEntry,
  LogLevel,
  LoggingConfigShape,
  ChannelConfig,
  BoundLogger,
} from "./types.ts";
import { LEVEL_ORDER } from "./types.ts";
import type { TableData } from "./renderTable.ts";
import { ConsoleChannel } from "./channels/ConsoleChannel.ts";
import { DailyChannel } from "./channels/DailyChannel.ts";
import { SingleChannel } from "./channels/SingleChannel.ts";
import { StackChannel } from "./channels/StackChannel.ts";
import { NullChannel } from "./channels/NullChannel.ts";
import { DEFAULT_LOG_PATH, DEFAULT_LOG_RETENTION_DAYS } from "./config.ts";

function levelNum(l: LogLevel): number {
  return LEVEL_ORDER[l] ?? 1;
}

function configLevel(cfg: ChannelConfig | undefined): LogLevel | undefined {
  return cfg && "level" in cfg ? cfg.level : undefined;
}

/**
 * Which always-on sinks a channel already covers.
 *
 * A channel that prints to the console, or writes to a file, would otherwise
 * double up with the baseline sink doing the same thing — so for entries routed
 * through it, the baseline it covers stands down.
 */
interface _Covers {
  console: boolean;
  file: boolean;
}

interface _Resolved {
  impl: LogChannel;
  minLevel: LogLevel;
  covers: _Covers;
}

/** One always-on destination and the level it accepts from. */
interface _Sink {
  impl: LogChannel;
  minLevel: LogLevel;
}
interface _Enrich {
  app?: string | undefined;
  env?: string | undefined;
  hostname: string;
  pid: number;
}

/**
 * The engine behind Zerotal's logging: builds a {@link LogChannel} for every
 * entry in {@link LoggingConfigShape.channels}, enriches each
 * {@link LogEntry} (timestamp, hostname, pid, app/env, request id), filters by
 * each channel's minimum {@link LogLevel}, and dispatches the write.
 *
 * Implements {@link BoundLogger}, so the five level methods log to the default
 * channel; use {@link LogManager.channel | channel} to target another and
 * {@link LogManager.withContext | withContext} for contextual logging. Normally
 * resolved via the {@link Log} facade rather than constructed directly.
 *
 * Channel `write` failures are swallowed (reported to stderr) so logging can
 * never throw into application code.
 *
 * @category Logging
 *
 * @example
 * ```ts
 * const log = new LogManager({
 *   default: "console",
 *   channels: { console: { driver: "console", format: "pretty" } },
 * });
 * log.info("Server started", { port: 3000 });
 * log.channel("console").error("Boom", {}, new Error("kaboom"));
 * ```
 */
export class LogManager implements BoundLogger {
  private readonly _resolved: Map<string, _Resolved> = new Map();
  private readonly _default: string;
  private readonly _enrich: _Enrich;
  /** The terminal, unless `logging.console` is `false`. */
  private _console: _Sink | null = null;
  /** The durable file trail, unless `logging.file` is `false`. */
  private _file: _Sink | null = null;

  /**
   * @param config - Channel map and default-channel selection.
   * @param enrich - Overrides for the enrichment fields (`app`, `env`,
   *   `hostname`, `pid`); `hostname` and `pid` default to the current host/process.
   * @param override - When supplied, replaces the default channel's
   *   implementation with this {@link LogChannel} and skips building the rest —
   *   primarily used in tests.
   * @throws {Error} If a `stack` channel references an unknown channel name, or
   *   a channel declares an unknown `driver`.
   */
  constructor(config: LoggingConfigShape, enrich?: Partial<_Enrich>, override?: LogChannel) {
    this._default = config.default;
    this._enrich = {
      app: enrich?.app,
      env: enrich?.env,
      hostname: enrich?.hostname ?? os.hostname(),
      pid: enrich?.pid ?? process.pid,
    };

    if (override) {
      // A test substituting one channel wants exactly that channel, not the
      // terminal and a directory of files alongside it.
      this._resolved.set(config.default, {
        impl: override,
        minLevel: configLevel(config.channels[config.default]) ?? "debug",
        covers: { console: true, file: true },
      });
      return;
    }

    // Absent means off, not "on with defaults": the defaults live in
    // `LoggingConfig()`, which is what an application's config goes through. A
    // hand-built config — a test, a bespoke embedding — gets exactly the sinks it
    // asked for and never starts writing files somewhere it was not told to.
    if (config.console) {
      this._console = {
        impl: new ConsoleChannel(config.console.format ?? "pretty"),
        minLevel: config.console.level ?? "debug",
      };
    }

    if (config.file) {
      this._file = {
        impl: new DailyChannel(
          config.file.path ?? DEFAULT_LOG_PATH,
          config.file.days ?? DEFAULT_LOG_RETENTION_DAYS,
        ),
        minLevel: config.file.level ?? "debug",
      };
    }

    for (const [name, cfg] of Object.entries(config.channels)) {
      this._resolved.set(name, {
        impl: this._make(name, cfg, config.channels),
        minLevel: configLevel(cfg) ?? "debug",
        covers: this._coverage(cfg, config.channels),
      });
    }
  }

  /**
   * Which baseline sinks `cfg` already writes to, walking a `stack` into its
   * members so a stack containing a console channel still suppresses the
   * baseline console.
   */
  private _coverage(
    cfg: ChannelConfig,
    all: Record<string, ChannelConfig>,
    seen = new Set<string>(),
  ): _Covers {
    switch (cfg.driver) {
      case "console":
        return { console: true, file: false };
      case "single":
      case "daily":
        return { console: false, file: true };
      case "stack": {
        const covers: _Covers = { console: false, file: false };
        for (const name of cfg.channels) {
          // A stack cannot cover a member twice, and a cycle must not hang the
          // constructor — `_make` rejects unknown names, so absence is enough here.
          if (seen.has(name)) continue;
          seen.add(name);
          const child = all[name];
          if (!child) continue;
          const childCovers = this._coverage(child, all, seen);
          covers.console ||= childCovers.console;
          covers.file ||= childCovers.file;
        }
        return covers;
      }
      default:
        return { console: false, file: false };
    }
  }

  /** Log a `debug`-level message to the default channel. @category Logging */
  debug(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    this._emit(this._default, "debug", msg, ctx, err);
  }
  /** Log an `info`-level message to the default channel. @category Logging */
  info(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    this._emit(this._default, "info", msg, ctx, err);
  }
  /** Log a `warn`-level message to the default channel. @category Logging */
  warn(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    this._emit(this._default, "warn", msg, ctx, err);
  }
  /** Log an `error`-level message to the default channel. @category Logging */
  error(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    this._emit(this._default, "error", msg, ctx, err);
  }
  /** Log a `fatal`-level message to the default channel. @category Logging */
  fatal(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    this._emit(this._default, "fatal", msg, ctx, err);
  }

  /**
   * Log `msg` with `rows` attached, rendered as a box-drawn table by the console
   * channel. Past three or four keys an inline JSON blob stops being readable;
   * the same data in columns can be scanned.
   *
   * The rows are ordinary context, so file and JSON channels record what any
   * other level method would have recorded — only the presentation differs.
   *
   * @param rows  One object (rendered as key/value rows) or a list of objects
   *   (rendered as a column per key, with a header).
   * @param level Severity to emit at. Defaults to `info`.
   * @category Logging
   *
   * @example
   * ```ts
   * Log.table("Compile summary", { compiled: 4, cached: 2, runtime: 8 });
   * Log.table("Slow routes", [
   *   { route: "/posts", ms: 812 },
   *   { route: "/search", ms: 1204 },
   * ], "warn");
   * ```
   */
  table(msg: string, rows: TableData, level: LogLevel = "info"): void {
    this._emitTable(this._default, level, msg, rows, undefined);
  }

  /**
   * Return a {@link BoundLogger} that writes to the named channel instead of the
   * default. Unknown channel names are silently ignored (nothing is emitted).
   *
   * @param name - Name of a channel from the config.
   * @category Channels
   *
   * @example
   * ```ts
   * log.channel("daily").info("Written to today's rotating file");
   * ```
   */
  channel(name: string): BoundLogger {
    return this._bound(name, undefined);
  }

  /**
   * Return a {@link BoundLogger} on the default channel that merges `extra` into
   * the context of every entry it emits. Per-call context keys override the
   * shared ones.
   *
   * @param extra - Context fields shared across all subsequent log calls.
   * @category Context
   *
   * @example
   * ```ts
   * const scoped = log.withContext({ orderId: 99 });
   * scoped.info("Charged");            // context: { orderId: 99 }
   * scoped.warn("Retry", { attempt: 2 }); // context: { orderId: 99, attempt: 2 }
   * ```
   */
  withContext(extra: Record<string, unknown>): BoundLogger {
    return this._bound(this._default, extra);
  }

  /**
   * Return a {@link BoundLogger} that tags every entry with the subsystem it
   * came from. The console channel renders the tag as `[FLOW]`; file and JSON
   * channels keep it as a `scope` field, so a log file can be filtered by source.
   *
   * @param name - Subsystem name, e.g. `"flow"`, `"queue"`.
   * @category Context
   *
   * @example
   * ```ts
   * const log = Log.scope("queue");
   * log.info("Worker started", { queues: ["default"] });
   * // 01:08:35.224 INFO  [QUEUE]  Worker started {"queues":["default"]}
   * ```
   */
  scope(name: string): BoundLogger {
    return this._bound(this._default, undefined, name);
  }

  private _bound(
    ch: string,
    extra: Record<string, unknown> | undefined,
    scope?: string,
  ): BoundLogger {
    const merge = (ctx?: Record<string, unknown>): Record<string, unknown> | undefined =>
      extra ? { ...extra, ...ctx } : ctx;
    return {
      debug: (msg, ctx, err) => this._emit(ch, "debug", msg, merge(ctx), err, scope),
      info: (msg, ctx, err) => this._emit(ch, "info", msg, merge(ctx), err, scope),
      warn: (msg, ctx, err) => this._emit(ch, "warn", msg, merge(ctx), err, scope),
      error: (msg, ctx, err) => this._emit(ch, "error", msg, merge(ctx), err, scope),
      fatal: (msg, ctx, err) => this._emit(ch, "fatal", msg, merge(ctx), err, scope),
      table: (msg, rows, level = "info") => this._emitTable(ch, level, msg, rows, scope, extra),
    };
  }

  /**
   * Attach `rows` as context and mark the entry for table rendering. A list of
   * rows is nested under `rows` so the entry's context stays an object, which is
   * what every channel and collector expects.
   */
  private _emitTable(
    ch: string,
    level: LogLevel,
    msg: string,
    rows: TableData,
    scope?: string,
    extra?: Record<string, unknown>,
  ): void {
    const data = Array.isArray(rows) ? { rows } : (rows as Record<string, unknown>);
    this._emit(ch, level, msg, { ...extra, ...data }, undefined, scope, "table");
  }

  private _emit(
    ch: string,
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>,
    err?: unknown,
    scope?: string,
    display?: "table",
  ): void {
    const resolved = this._resolved.get(ch);

    // Which destinations want this entry. The routed channel is one of them, not
    // the gatekeeper: a channel filtered to `warn` must not also hide the entry
    // from the file trail or from monitor.
    const toChannel = resolved !== undefined && levelNum(level) >= levelNum(resolved.minLevel);
    const toConsole =
      this._console !== null &&
      !resolved?.covers.console &&
      levelNum(level) >= levelNum(this._console.minLevel);
    const toFile =
      this._file !== null &&
      !resolved?.covers.file &&
      levelNum(level) >= levelNum(this._file.minLevel);

    if (!toChannel && !toConsole && !toFile && LogManager._taps.length === 0) return;

    const requestId = RequestContext.tryGet()?.requestId;

    const entry: LogEntry = {
      level,
      channel: ch,
      message: msg,
      timestamp: new Date().toISOString(),
      ...this._enrich,
      ...(scope ? { scope } : {}),
      ...(display ? { display } : {}),
      ...(requestId ? { requestId } : {}),
      ...(ctx && Object.keys(ctx).length > 0 ? { context: ctx } : {}),
    };

    if (err !== undefined) {
      if (err instanceof Error) {
        entry.error = err.message;
        if (err.stack) entry.stack = err.stack;
      } else {
        entry.error = String(err);
      }
    }

    for (const tap of LogManager._taps) {
      try {
        tap(entry);
      } catch {
        /* a tap must never break logging */
      }
    }

    if (toConsole) this._dispatch(this._console!.impl, entry);
    if (toFile) this._dispatch(this._file!.impl, entry);
    if (toChannel) this._dispatch(resolved!.impl, entry);
  }

  /** Write to one destination, never letting its failure reach the caller. */
  private _dispatch(channel: LogChannel, entry: LogEntry): void {
    channel.write(entry).catch((e: unknown) => {
      process.stderr.write(`[Zerotal/Log] channel write failed: ${String(e)}\n`);
    });
  }

  private static _taps: Array<(entry: LogEntry) => void> = [];

  /**
   * Register a sink invoked for every log entry, after enrichment and before the
   * channel write. Used by `@zerotal/monitor` to surface logs in the panel.
   * Returns an unsubscribe function.
   */
  static tap(fn: (entry: LogEntry) => void): () => void {
    LogManager._taps.push(fn);
    return () => {
      const i = LogManager._taps.indexOf(fn);
      if (i >= 0) LogManager._taps.splice(i, 1);
    };
  }

  private _make(name: string, cfg: ChannelConfig, all: Record<string, ChannelConfig>): LogChannel {
    switch (cfg.driver) {
      case "console":
        return new ConsoleChannel(cfg.format);
      case "single":
        return new SingleChannel(cfg.path);
      case "daily":
        return new DailyChannel(cfg.path, cfg.days);
      case "stack":
        return new StackChannel(
          cfg.channels.map((c) => {
            const child = all[c];
            if (!child) throw new Error(`Log stack references unknown channel "${c}"`);
            return this._make(c, child, all);
          }),
        );
      case "null":
        return new NullChannel();
      default:
        throw new Error(`Unknown log driver: ${(cfg as any).driver} on channel "${name}"`);
    }
  }
}
