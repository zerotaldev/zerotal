import { deepMerge } from "@zerotal/core";
import type { RedactionOptions } from "./redaction.ts";

export interface DevtoolsConfigShape {
  /**
   * How many request traces to keep in memory and reload on start.
   * Default: `100`.
   */
  capacity: number;
  /**
   * SQLite file backing the trace history, so it survives a restart. Set to
   * `null` to keep traces in memory only — nothing is written to disk.
   * Default: `.zerotal/devtools.sqlite`, or `ZT_DEVTOOLS_DB`.
   */
  dbPath: string | null;
  /**
   * How long a persisted trace survives, in hours.
   * Default: `24`, or `ZT_DEVTOOLS_PRUNE_HOURS`.
   */
  pruneHours: number;
  /**
   * Whether query bindings are masked before a trace leaves the process.
   *
   * On by default: a trace is streamed to the browser *and* written to disk for
   * a day, and bindings are the request's real values — the password on a
   * registration, a reset token, every customer email a listing selects by.
   * Turn it off only when you are debugging the values themselves.
   */
  redact: RedactionOptions;
}

const defaults: DevtoolsConfigShape = {
  capacity: 100,
  dbPath: Bun.env["ZT_DEVTOOLS_DB"] ?? ".zerotal/devtools.sqlite",
  pruneHours: Number(Bun.env["ZT_DEVTOOLS_PRUNE_HOURS"] ?? 24),
  redact: { enabled: true, allow: [], deny: [] },
};

/**
 * Create a typed devtools configuration object with defaults.
 *
 * @example
 * // config/devtools.ts
 * import { DevtoolsConfig } from '@zerotal/devtools';
 *
 * export default DevtoolsConfig({
 *   capacity: 250,
 *   redact: { allow: ['email', 'slug'] },
 * });
 */
export function DevtoolsConfig(options: Partial<DevtoolsConfigShape> = {}): DevtoolsConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    devtools: DevtoolsConfigShape;
  }
}
