import type { LogChannel, LogEntry } from "../types.ts";
import type { StorageDriver } from "../../storage/types.ts";
import { LocalDriver } from "../../storage/drivers/LocalDriver.ts";
import { readdir, stat, unlink } from "node:fs/promises";

/**
 * Appends entries as JSON lines to a date-rotated file, one file per day named
 * `YYYY-MM-DD.log` (derived from the entry's timestamp) inside a directory.
 *
 * Writes go through a {@link StorageDriver}, so the log trail uses the same file
 * API as uploads and the media library rather than a second, private way of
 * putting bytes on disk — and inherits its path-traversal guard for free.
 *
 * When a retention window (`days`) is given, files whose modification time is
 * older than the cutoff are pruned — checked at most once every 24 hours, in
 * the background, and only on write. The directory is created on demand.
 *
 * @category Channels
 *
 * @example
 * ```ts
 * // config/logging.ts — keep 14 days of daily files under ./storage/logs
 * file: { path: "./storage/logs", days: 14 },
 * ```
 */
export class DailyChannel implements LogChannel {
  private _lastPruned = 0;
  private readonly _disk: StorageDriver;

  /**
   * @param _dir - Directory that holds the per-day log files.
   * @param _days - Retention window in days; older files are pruned. Omit to keep files forever.
   * @param disk - Driver to write through. Defaults to a {@link LocalDriver} rooted at `_dir`.
   *   Pass one to send the trail somewhere else — it must support `append`, which
   *   rules out object stores.
   */
  constructor(
    private readonly _dir: string,
    private readonly _days?: number,
    disk?: StorageDriver,
  ) {
    this._disk = disk ?? new LocalDriver(_dir);
  }

  async write(entry: LogEntry): Promise<void> {
    const date = entry.timestamp.slice(0, 10);
    await this._disk.append(`${date}.log`, JSON.stringify(entry) + "\n");

    if (this._days !== undefined) {
      const now = Date.now();
      if (now - this._lastPruned > 86_400_000) {
        this._lastPruned = now;
        void this._prune(now).catch(() => {});
      }
    }
  }

  /**
   * Delete day-files older than the retention window.
   *
   * Listing and stat'ing stay on `node:fs`: the driver contract has no
   * directory listing, and inventing one for a log pruner would widen it for
   * every backend to serve a single caller.
   */
  private async _prune(now: number): Promise<void> {
    const cutoff = now - this._days! * 86_400_000;
    const files = await readdir(this._dir);
    for (const file of files) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
      const s = await stat(`${this._dir}/${file}`);
      if (s.mtimeMs < cutoff) await unlink(`${this._dir}/${file}`);
    }
  }
}
