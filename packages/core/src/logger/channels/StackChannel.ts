import type { LogChannel, LogEntry } from "../types.ts";

/**
 * Fans one entry out to several child channels at once — e.g. print to the
 * console *and* persist to a daily file from a single log call.
 *
 * Writes are dispatched with `Promise.allSettled`, so one failing child channel
 * never stops the others from receiving the entry.
 *
 * @category Channels
 *
 * @example
 * ```ts
 * // config/logging.ts — "stack" references other channels by name
 * channels: {
 *   stack: { driver: "stack", channels: ["console", "daily"] },
 *   console: { driver: "console", format: "pretty" },
 *   daily: { driver: "daily", path: "./storage/logs", days: 7 },
 * }
 * ```
 */
export class StackChannel implements LogChannel {
  /** @param _channels - The resolved child channels to broadcast each entry to. */
  constructor(private readonly _channels: LogChannel[]) {}

  async write(entry: LogEntry): Promise<void> {
    await Promise.allSettled(this._channels.map((ch) => ch.write(entry)));
  }
}
