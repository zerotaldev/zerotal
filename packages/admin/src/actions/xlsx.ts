/**
 * A spreadsheet writer, for exports that need to open in Excel as a spreadsheet
 * rather than as text.
 *
 * CSV is the better interchange format and stays the default. This exists for
 * the case CSV genuinely cannot serve: a recipient who opens the file, sees
 * `007` turned into `7` and a leading `=` treated as a formula, and reasonably
 * calls the export broken. Writing real cell types fixes that at the source.
 *
 * An `.xlsx` is a ZIP of XML parts, so the whole format is built here from two
 * small pieces — a ZIP writer and a sheet serialiser — rather than pulling in a
 * spreadsheet library for what an export button needs. The scope is deliberately
 * one sheet with a header row and typed cells: no formulas, charts or merges.
 */
import type { Column } from "../table/Column.ts";

// ── ZIP ──────────────────────────────────────────────────────────────────────

/** Entries are stored uncompressed — valid ZIP, and an export is written once. */
const STORED = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Pack entries into a ZIP archive.
 *
 * Timestamps are fixed rather than taken from the clock, so exporting the same
 * rows twice produces byte-identical files — which makes the output testable and
 * keeps a checksum meaningful.
 */
function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const sum = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, STORED, true);
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x0021, true); // date — 1980-01-01, the ZIP epoch
    lv.setUint32(14, sum, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    chunks.push(local, entry.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true);
    dv.setUint16(10, STORED, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0x0021, true);
    dv.setUint32(16, sum, true);
    dv.setUint32(20, entry.data.length, true);
    dv.setUint32(24, entry.data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true); // offset of the local header
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ── Sheet ────────────────────────────────────────────────────────────────────

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Whether a character is one XML will not accept.
 *
 * Tab, newline and carriage return are legal; the rest of the C0 range is not,
 * and a single one of them makes the whole file unopenable. Checked by code
 * point rather than by a regular expression, because a regex literal holding
 * raw control characters is unreadable and easy to mangle.
 */
function isIllegalXmlChar(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

function escapeXml(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isIllegalXmlChar(code)) continue;
    out +=
      char === "&"
        ? "&amp;"
        : char === "<"
          ? "&lt;"
          : char === ">"
            ? "&gt;"
            : char === '"'
              ? "&quot;"
              : char;
  }
  return out;
}

/** `0 → A`, `26 → AA`. */
function columnLetter(index: number): string {
  let out = "";
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Days since 1899-12-30, the epoch spreadsheets count dates from.
 *
 * The two-day offset from 1900-01-01 is the usual one: the format deliberately
 * repeats a bug that treated 1900 as a leap year, and every reader expects it.
 */
function excelSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

type CellValue = string | number | boolean | Date | null;

function cellXml(ref: string, value: CellValue): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : "";
  }
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (value instanceof Date) {
    return `<c r="${ref}" s="2"><v>${excelSerial(value)}</v></c>`;
  }
  // Inline rather than via a shared-string table: one pass, no second index to
  // keep consistent, and the size difference does not matter for an export.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Read a cell's value with its type intact.
 *
 * A column's rendered text is the fallback, not the first choice: exporting
 * "R1,299.00" as a string gives a spreadsheet nothing to sum.
 */
function cellValue(column: Column, row: Record<string, unknown>): CellValue {
  const raw = column.raw(row);
  if (raw == null) return null;
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (raw instanceof Date) return raw;
  if (typeof raw === "string") {
    // A date column arrives as an ISO string from most drivers; keeping it a
    // date is what lets the recipient sort and filter by it.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})/.test(raw)) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return raw;
  }
  return column.cell(row).text;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Three styles: default, bold (the header row), and a date format.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Sheet names may not carry these, and may not exceed 31 characters. */
function sheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return escapeXml(cleaned.slice(0, 31) || "Sheet1");
}

/**
 * Build an `.xlsx` workbook: one sheet, a bold header row from the column
 * labels, and one row per record with values typed rather than stringified.
 *
 * The header row is frozen and an auto-filter is set over the used range, since
 * an exported table is nearly always going to be sorted or filtered on arrival.
 */
export function toXlsx(
  rows: Record<string, unknown>[],
  columns: Column[],
  options: { sheet?: string } = {},
): Uint8Array {
  const header = columns
    .map((c, i) => {
      const ref = `${columnLetter(i)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(c.getLabel())}</t></is></c>`;
    })
    .join("");

  const body = rows
    .map((row, r) => {
      const cells = columns
        .map((c, i) => cellXml(`${columnLetter(i)}${r + 2}`, cellValue(c, row)))
        .join("");
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join("");

  const lastColumn = columnLetter(Math.max(0, columns.length - 1));
  const lastRow = rows.length + 1;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetData><row r="1">${header}</row>${body}</sheetData>
<autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName(options.sheet ?? "Sheet1")}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  return zip([
    // `[Content_Types].xml` must come first — readers look for it at the front.
    { name: "[Content_Types].xml", data: utf8(CONTENT_TYPES) },
    { name: "_rels/.rels", data: utf8(ROOT_RELS) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: utf8(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheet) },
  ]);
}
