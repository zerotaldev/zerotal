import { describe, expect, test } from "bun:test";
import { toXlsx } from "./xlsx.ts";
import { text } from "../table/Column.ts";

const columns = [text("name").label("Name"), text("total").label("Total")];

/**
 * Read a stored entry back out of the archive.
 *
 * The point of unpacking rather than string-matching the buffer is that it only
 * succeeds if the offsets, sizes and signatures are right — which is the part of
 * a hand-written ZIP that can actually be wrong.
 */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();

  // Walk the central directory from the end-of-central-directory record.
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  expect(eocd).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const size = view.getUint32(at + 24, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    // Follow the pointer into the local header and read the payload after it.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));

    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

describe("toXlsx", () => {
  test("writes an archive holding every part a workbook needs", () => {
    const parts = unzip(toXlsx([{ name: "Ada", total: 12 }], columns));

    expect([...parts.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  test("starts with the ZIP signature, so a reader recognises the file", () => {
    const bytes = toXlsx([], columns);
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  test("writes the column labels as the first row", () => {
    const sheet = unzip(toXlsx([], columns)).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain(">Name<");
    expect(sheet).toContain(">Total<");
  });

  test("keeps numbers numeric and text as text", () => {
    const sheet = unzip(toXlsx([{ name: "Ada", total: 12 }], columns)).get(
      "xl/worksheets/sheet1.xml",
    )!;
    // A number is a bare value; only text carries the inline-string type.
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr">');
  });

  test("escapes markup rather than emitting broken XML", () => {
    const sheet = unzip(toXlsx([{ name: '<a href="x">&', total: 1 }], columns)).get(
      "xl/worksheets/sheet1.xml",
    )!;
    expect(sheet).toContain("&lt;a href=&quot;x&quot;&gt;&amp;");
    expect(sheet).not.toContain('<a href="x">');
  });

  test("turns an ISO timestamp into a dated cell", () => {
    const dated = [text("name"), text("created_at")];
    const sheet = unzip(toXlsx([{ name: "Ada", created_at: "2026-07-28T00:00:00Z" }], dated)).get(
      "xl/worksheets/sheet1.xml",
    )!;
    // Style 2 is the date format; the serial is days since 1899-12-30.
    expect(sheet).toContain('<c r="B2" s="2"><v>46231</v></c>');
  });

  test("names the sheet, trimming what the format disallows", () => {
    const workbook = unzip(toXlsx([], columns, { sheet: "Orders/2026" })).get("xl/workbook.xml")!;
    expect(workbook).toContain('name="Orders 2026"');
  });

  test("exports the same rows to the same bytes", () => {
    const rows = [{ name: "Ada", total: 12 }];
    expect(toXlsx(rows, columns)).toEqual(toXlsx(rows, columns));
  });

  test("lettering carries past Z", () => {
    const many = Array.from({ length: 28 }, (_, i) => text(`c${i}`));
    const sheet = unzip(toXlsx([{ c27: "last" }], many)).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="AB2"');
  });
});
