import type { LogChannel, LogEntry } from "../types.ts";
import { renderTable } from "../renderTable.ts";
import { formatPairs, visibleWidth } from "../format.ts";

const LEVEL_COLOR: Record<string, string> = {
  debug: "\x1b[2m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[95m",
};

const RESET = "\x1b[0m";

/** Visible width reserved for the `[SCOPE]` tag column. */
const SCOPE_WIDTH = 10;
/** Characters the dim/reset escapes add to the tag without taking any width. */
const DIM_OVERHEAD = "\x1b[2m".length + RESET.length;
/** Assumed page width when stdout is a pipe or a file rather than a terminal. */
const DEFAULT_WIDTH = 120;
/** Floor for a wrapped context line, so a narrow terminal still gets whole pairs. */
const MIN_WRAP_WIDTH = 20;

/**
 * Writes log entries to `process.stdout`.
 *
 * In `"pretty"` format (the default) it emits a colorized, human-readable line
 * — dimmed time, level-colored level, message, an 8-char request-id snippet,
 * inline context JSON, and any error/stack. In `"json"` format it writes the
 * full {@link LogEntry} as one JSON line, suitable for log collectors.
 *
 * @category Channels
 *
 * @example
 * ```ts
 * // config/logging.ts
 * channels: {
 *   console: { driver: "console", format: "json" }, // or "pretty"
 * }
 * ```
 */
export class ConsoleChannel implements LogChannel {
  /** @param _format - `"pretty"` for colorized output (default) or `"json"` for one JSON line per entry. */
  constructor(private readonly _format: "json" | "pretty" = "pretty") {}

  async write(entry: LogEntry): Promise<void> {
    if (this._format === "json") {
      process.stdout.write(JSON.stringify(entry) + "\n");
      return;
    }

    const color = LEVEL_COLOR[entry.level] ?? "";
    const time = entry.timestamp.slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(5);
    // Padded so messages line up down the column whether or not an entry is
    // scoped — the tag is what makes a boot log readable at a glance.
    const scope = entry.scope
      ? `\x1b[2m[${entry.scope.toUpperCase()}]${RESET}`.padEnd(SCOPE_WIDTH + DIM_OVERHEAD)
      : " ".repeat(SCOPE_WIDTH);

    // The gutter every continuation line is indented to, so wrapped context sits
    // under the message rather than under the timestamp. Measured rather than
    // hard-coded, so it follows the columns above if they ever change.
    const prefix = `\x1b[2m${time}${RESET} ${color}${level}${RESET} ${scope} `;
    let line = `${prefix}${entry.message}`;

    if (entry.requestId !== undefined) {
      line += ` \x1b[2m[${entry.requestId.slice(0, 8)}]${RESET}`;
    }
    if (entry.context !== undefined && Object.keys(entry.context).length > 0) {
      if (entry.display === "table") {
        const { rows } = entry.context as { rows?: unknown };
        const data = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : entry.context;
        const table = renderTable(data);
        if (table.length > 0) line += `\n${table.join("\n")}`;
      } else {
        line += this._context(entry.context, line, visibleWidth(prefix));
      }
    }
    if (entry.error !== undefined) {
      line += `\n  \x1b[31m${entry.error}${RESET}`;
    }
    if (entry.stack !== undefined) {
      line += `\n\x1b[2m${entry.stack}${RESET}`;
    }

    process.stdout.write(line + "\n");
  }

  /**
   * Context appended to the message, or folded onto continuation lines when it
   * would run past the terminal's edge.
   *
   * A short bag stays inline, because one event reading as one line is worth
   * keeping. A long one wrapped by the terminal itself breaks mid-pair at a
   * random column and buries the message it belongs to, so it is laid out here
   * instead: indented to the message gutter, marked with a `↳`, and filled
   * greedily so each line carries as many whole pairs as fit.
   *
   * @param head   The line so far, whose width decides whether the rest fits.
   * @param gutter Visible width of the timestamp/level/scope columns.
   */
  private _context(context: Record<string, unknown>, head: string, gutter: number): string {
    const pairs = formatPairs(context);
    const inline = pairs.map((pair) => ` ${pair}`).join("");
    const columns = _terminalWidth();

    if (visibleWidth(head) + visibleWidth(inline) <= columns) return inline;

    const indent = " ".repeat(gutter);
    // Never let a narrow terminal squeeze the text to nothing; below this the
    // pairs simply go one per line.
    const room = Math.max(columns - gutter - 2, MIN_WRAP_WIDTH);

    const lines: string[] = [];
    let current = "";
    for (const pair of pairs) {
      const candidate = current === "" ? pair : `${current} ${pair}`;
      if (current !== "" && visibleWidth(candidate) > room) {
        lines.push(current);
        current = pair;
      } else {
        current = candidate;
      }
    }
    if (current !== "") lines.push(current);

    // Only the first continuation carries the marker; the rest align under it.
    return lines
      .map((text, index) => `\n${indent}${index === 0 ? `\x1b[2m↳${RESET}` : " "} ${text}`)
      .join("");
  }
}

/** Terminal width, or a sensible page width when output is not a terminal. */
function _terminalWidth(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : DEFAULT_WIDTH;
}
