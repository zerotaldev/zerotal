import type { LogChannel, LogEntry } from "../types.ts";
import { appendFile, mkdir } from "node:fs/promises";

/**
 * Appends every entry as a JSON line to a single, fixed log file.
 *
 * Parent directories are created on demand. Write failures are swallowed so a
 * logging error never propagates into application code.
 *
 * @category Channels
 *
 * @example
 * ```ts
 * // config/logging.ts
 * channels: {
 *   single: { driver: "single", path: "./storage/logs/app.log", level: "info" },
 * }
 * ```
 */
export class SingleChannel implements LogChannel {
  /** @param _file - Path to the log file to append to (config key `path`). */
  constructor(private readonly _file: string) {}

  async write(entry: LogEntry): Promise<void> {
    try {
      const lastSlash = Math.max(this._file.lastIndexOf("/"), this._file.lastIndexOf("\\"));
      const dir = lastSlash > 0 ? this._file.slice(0, lastSlash) : ".";
      await mkdir(dir, { recursive: true });
      await appendFile(this._file, JSON.stringify(entry) + "\n");
    } catch {
      return;
    }
  }
}
