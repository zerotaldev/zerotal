/**
 * CSV encoding and decoding for the import/export actions.
 *
 * Deliberately small and dependency-free, but strict about the two things that
 * actually bite: quoting on the way out (a comma, quote or newline inside a
 * value must not shift every later column) and quote handling on the way in.
 */
import type { Column } from "../table/Column.ts";

/** Quote a field when it contains anything that would otherwise break the row. */
function encodeField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Render a value for a CSV cell.
 *
 * Primitives go out as themselves — a date export should be re-importable, not
 * "3 days ago". Anything structured (a loaded relation, a JSON column) falls
 * back to the column's display text, which is the only meaningful flat form.
 */
function encodeValue(column: Column, row: Record<string, unknown>): string {
  const raw = column.raw(row);
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return String(raw);
  }
  if (raw instanceof Date) return raw.toISOString();
  return column.cell(row).text;
}

/** Serialise rows to CSV with a header line, one column per exportable column. */
export function toCsv(rows: Record<string, unknown>[], columns: Column[]): string {
  const header = columns.map((c) => encodeField(c.getLabel())).join(",");
  const body = rows.map((row) => columns.map((c) => encodeField(encodeValue(c, row))).join(","));
  return [header, ...body].join("\r\n");
}

/**
 * Parse CSV into rows of raw strings, the first row being the header.
 *
 * Handles quoted fields containing commas, escaped quotes (`""`) and embedded
 * newlines. Returns an empty array for empty input rather than a phantom row.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, ""); // strip a spreadsheet's byte-order mark
  if (source.trim() === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote is a literal one; a lone quote closes the field.
      if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // Swallow it; the \n that follows ends the row.
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // A file not ending in a newline still has one row left in hand.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Pair a CSV's header cells with resource fields.
 *
 * Matching is forgiving about the ways a label and a key differ in practice —
 * case, spaces, underscores, hyphens — so a file exported from the panel
 * re-imports without the user mapping a single column by hand.
 *
 * @internal
 */
export function guessColumnMapping(
  headers: string[],
  candidates: { key: string; label: string }[],
): Record<number, string> {
  const normalize = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, "");
  const byKey = new Map<string, string>();
  for (const c of candidates) {
    byKey.set(normalize(c.key), c.key);
    byKey.set(normalize(c.label), c.key);
  }

  const mapping: Record<number, string> = {};
  headers.forEach((header, i) => {
    const match = byKey.get(normalize(header));
    if (match) mapping[i] = match;
  });
  return mapping;
}
