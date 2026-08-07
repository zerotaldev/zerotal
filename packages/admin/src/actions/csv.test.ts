import { describe, it, expect } from "bun:test";
import { toCsv, parseCsv, guessColumnMapping } from "./csv.ts";
import { text } from "../table/Column.ts";

describe("toCsv", () => {
  it("writes a header from the column labels", () => {
    const csv = toCsv([], [text("id"), text("name").label("Full name")]);
    expect(csv).toBe("Id,Full name");
  });

  it("quotes values containing a comma, quote or newline", () => {
    const rows = [{ note: 'He said "go", then left\nquickly' }];
    const csv = toCsv(rows, [text("note")]);
    expect(csv).toBe('Note\r\n"He said ""go"", then left\nquickly"');
  });

  it("writes primitives as themselves rather than as display text", () => {
    // A formatted date would not survive a round-trip; the raw value does.
    const when = new Date("2026-07-28T10:00:00.000Z");
    const rows = [{ total: 42, active: true, at: when, missing: null }];
    const csv = toCsv(rows, [text("total"), text("active"), text("at"), text("missing")]);
    expect(csv.split("\r\n")[1]).toBe("42,true,2026-07-28T10:00:00.000Z,");
  });

  it("falls back to display text for structured values", () => {
    const rows = [{ author: { name: "Ada" } }];
    const csv = toCsv(rows, [text("author").format((a) => (a as { name: string }).name)]);
    expect(csv.split("\r\n")[1]).toBe("Ada");
  });
});

describe("parseCsv", () => {
  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  ")).toEqual([]);
  });

  it("splits a plain file into header and rows", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('name,note\r\n"Ada","said ""hi"", then\nleft"');
    expect(rows).toEqual([
      ["name", "note"],
      ["Ada", 'said "hi", then\nleft'],
    ]);
  });

  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("strips a spreadsheet byte-order mark", () => {
    expect(parseCsv("﻿id,name\n1,Ada")[0]).toEqual(["id", "name"]);
  });

  it("round-trips what toCsv produced", () => {
    const rows = [{ name: 'A, "B"', note: "line\nbreak" }];
    const parsed = parseCsv(toCsv(rows, [text("name"), text("note")]));
    expect(parsed[1]).toEqual(['A, "B"', "line\nbreak"]);
  });
});

describe("guessColumnMapping", () => {
  const candidates = [
    { key: "name", label: "Full name" },
    { key: "email_address", label: "Email" },
  ];

  it("matches a header to a field key or label, ignoring case and separators", () => {
    expect(guessColumnMapping(["Full Name", "email address"], candidates)).toEqual({
      0: "name",
      1: "email_address",
    });
  });

  it("leaves an unrecognised header unmapped for the user to resolve", () => {
    expect(guessColumnMapping(["nickname"], candidates)).toEqual({});
  });
});
