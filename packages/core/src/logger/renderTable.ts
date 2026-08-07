/**
 * Box-drawn tables for terminal log output.
 *
 * A structured entry is easy to write and hard to read: past three or four keys
 * an inline JSON blob is a wall the eye slides off. The same data in columns is
 * scannable, and lining values up makes an odd one out visible without reading
 * every key.
 */

import { displayValue } from "./format.ts";

/** Either one object rendered as key/value rows, or a list rendered as columns. */
export type TableData = Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Widest a single cell may render before it is truncated. */
const MAX_CELL = 60;

/**
 * Render `data` as the lines of a box-drawn table, without a trailing newline.
 *
 * An array of objects becomes a column per key, in the order the first row
 * introduces them, with a header. A single object becomes two columns of
 * key and value. Numeric columns are right-aligned so digits line up.
 *
 * @param data   Rows to render.
 * @param indent Spaces before each line, to sit the table under its message.
 * @returns One string per line; empty when there is nothing to show.
 *
 * @example
 * ```ts
 * renderTable([{ page: "home", ms: 12 }, { page: "about", ms: 4 }]).join("\n");
 * ```
 */
export function renderTable(data: TableData, indent = 2): string[] {
  const { headers, rows } = _shape(data);
  if (rows.length === 0) return [];

  const widths = headers.map((header, column) =>
    Math.max(_width(header), ...rows.map((row) => _width(row[column] ?? ""))),
  );

  // A column is numeric only if every cell in it is, so a "—" placeholder or a
  // stray label does not silently right-align a column of text.
  const numeric = headers.map((_, column) => rows.every((row) => _isNumeric(row[column] ?? "")));

  const pad = " ".repeat(indent);
  const rule = (left: string, mid: string, right: string): string =>
    `${pad}${DIM}${left}${widths.map((w) => "─".repeat(w + 2)).join(mid)}${right}${RESET}`;

  const line = (cells: readonly string[]): string => {
    const body = cells
      .map((cell, column) => ` ${_fit(cell, widths[column]!, numeric[column]!)} `)
      .join(`${DIM}│${RESET}`);
    return `${pad}${DIM}│${RESET}${body}${DIM}│${RESET}`;
  };

  const out = [rule("┌", "┬", "┐")];
  if (headers.some((header) => header !== "")) {
    out.push(line(headers), rule("├", "┼", "┤"));
  }
  for (const row of rows) out.push(line(headers.map((_, column) => row[column] ?? "")));
  out.push(rule("└", "┴", "┘"));
  return out;
}

// ── Private ──────────────────────────────────────────────────────────────────

/** Normalise either input shape into a header row plus string cells. */
function _shape(data: TableData): { headers: string[]; rows: string[][] } {
  if (Array.isArray(data)) {
    // Union of every row's keys, first-seen order — a row missing a key gets a
    // blank cell rather than shifting the table.
    const headers: string[] = [];
    for (const row of data) {
      for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
    }
    return {
      headers,
      rows: data.map((row) => headers.map((key) => displayValue(row[key]))),
    };
  }

  const entries = Object.entries(data);
  // No header on a key/value table: "key | value" is a caption for something the
  // reader can already see.
  return { headers: ["", ""], rows: entries.map(([key, value]) => [key, displayValue(value)]) };
}

function _isNumeric(cell: string): boolean {
  return cell !== "" && !Number.isNaN(Number(cell));
}

/** Visible width, ignoring any colour escapes a caller pre-formatted in. */
function _width(cell: string): number {
  return Math.min(_strip(cell).length, MAX_CELL);
}

function _strip(cell: string): string {
  // eslint-disable-next-line no-control-regex
  return cell.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Truncate to `width`, then pad to it — right-aligned for numbers. */
function _fit(cell: string, width: number, right: boolean): string {
  const visible = _strip(cell);
  const text = visible.length > width ? `${visible.slice(0, Math.max(0, width - 1))}…` : visible;
  return right ? text.padStart(width) : text.padEnd(width);
}
