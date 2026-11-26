import { deepMerge } from "../support/deepMerge.ts";
import { LEVEL_ORDER } from "./types.ts";
import type {
  LoggingConfigShape,
  ChannelConfig,
  ConsoleSinkConfig,
  FileSinkConfig,
  LogLevel,
} from "./types.ts";

export type { LoggingConfigShape, ChannelConfig, ConsoleSinkConfig, FileSinkConfig };

/** Where the always-on file trail writes, and how long a day's file survives. */
export const DEFAULT_LOG_PATH = "./storage/logs";
export const DEFAULT_LOG_RETENTION_DAYS = 14;

/**
 * Whether the file trail is on by default.
 *
 * Off under test: the path is relative to the working directory, so a suite
 * that boots an app would otherwise grow a `storage/logs` directory wherever it
 * happened to run — inside a package, inside a fixture, inside CI's checkout.
 * A test that wants the trail asks for it explicitly.
 */
function _fileDefault(): FileSinkConfig {
  // eslint-disable-next-line no-restricted-syntax -- asks about the test/testing runtime modes, not the deployment
  const env = (Bun.env["APP_ENV"] ?? "").trim().toLowerCase();
  if (env === "test" || env === "testing") return false;
  return { path: DEFAULT_LOG_PATH, days: DEFAULT_LOG_RETENTION_DAYS };
}

/**
 * The terminal's minimum level from `LOG_LEVEL`, when it names one of the five levels.
 *
 * Only the default: `console.level` in the app's logging config still wins. Anything
 * else in the variable is left alone rather than refused, since `LOG_LEVEL` is a common
 * name that other tools in the same shell read with their own set of values.
 */
function _envConsoleLevel(): LogLevel | undefined {
  const raw = (Bun.env["LOG_LEVEL"] ?? "").trim().toLowerCase();
  return _isLogLevel(raw) ? raw : undefined;
}

function _isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVEL_ORDER, value);
}

/** The terminal sink's defaults: pretty output, at `LOG_LEVEL`'s level when it sets one. */
function _consoleDefault(): ConsoleSinkConfig {
  const level = _envConsoleLevel();
  return level === undefined ? { format: "pretty" } : { format: "pretty", level };
}

const defaults: LoggingConfigShape = {
  console: { format: "pretty" },
  file: { path: DEFAULT_LOG_PATH, days: DEFAULT_LOG_RETENTION_DAYS },
  // `app` deliberately names no channel: the two sinks above are the
  // destination, and `channels` starts empty. Keeping the old
  // `default: "console"` here would make the baseline console print twice.
  default: "app",
  channels: {},
};

/**
 * Build a {@link LoggingConfigShape} with framework defaults applied.
 *
 * Out of the box every entry goes two places: the terminal, and a date-rotated
 * file under `./storage/logs` kept for 14 days. Both are on by default and
 * independent of each other — you can silence the terminal without losing the
 * trail, which is the entire point of having one.
 *
 * The terminal prints every level unless `LOG_LEVEL` names one (`debug`, `info`,
 * `warn`, `error`, `fatal`); `console.level` here outranks the variable. `bun zt test`
 * sets `LOG_LEVEL=warn` for the suite when nothing else has.
 *
 * Named `channels` are *extra* destinations layered on top, for routing a
 * subsystem somewhere specific. Because `channels` is a name-keyed map,
 * anything you add is merged in rather than replacing the map.
 *
 * @param options - Partial overrides deep-merged over the defaults.
 * @returns The resolved, fully-populated logging config.
 * @category Configuration
 *
 * @example
 * ```ts
 * // config/logging.ts — the defaults, spelled out
 * import { LoggingConfig } from "@zerotal/core/logger";
 *
 * export default LoggingConfig();
 * ```
 *
 * @example
 * ```ts
 * // Quiet terminal, full trail on disk, a month of history
 * export default LoggingConfig({
 *   console: { level: "warn" },
 *   file: { days: 30 },
 * });
 * ```
 *
 * @example
 * ```ts
 * // No files at all — containers that ship stdout to a collector
 * export default LoggingConfig({ file: false });
 * ```
 */
export function LoggingConfig(options: Partial<LoggingConfigShape> = {}): LoggingConfigShape {
  const merged = deepMerge(
    { ...defaults, console: _consoleDefault(), file: _fileDefault() },
    options,
  );
  // `deepMerge` merges an object over `false`, so an explicit switch-off — and
  // an explicit switch-*on* under test — is taken verbatim rather than being
  // overridden by the default.
  if (options.console === false) merged.console = false;
  if (options.file === false) merged.file = false;
  if (options.file !== undefined && options.file !== false) merged.file = options.file;
  return merged;
}

// The `logging` config namespace is registered directly on core's ConfigRegistry
// (see src/config/registry.ts) since the logger ships as part of core.
