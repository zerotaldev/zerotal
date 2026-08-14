/**
 * Detection, diagnosis, and the guards on the button.
 *
 * The detector's job is to recognise *only* what it owns: a diagnoser that
 * claims an error it cannot explain replaces a real stack trace with a wrong
 * answer, which is worse than the bare message it was meant to improve.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { detectMissingRelation } from "./missingRelation.ts";
import {
  _mintDiagnosisToken,
  _spendDiagnosisToken,
  _resetDiagnosisTokens,
} from "./runMigrationsEndpoint.ts";

/** An error carrying a driver code, the way a real one arrives. */
function coded(message: string, code?: string | number, errno?: number): Error {
  const error = new Error(message);
  if (code !== undefined) (error as { code?: string | number }).code = code;
  if (errno !== undefined) (error as { errno?: number }).errno = errno;
  return error;
}

describe("detectMissingRelation", () => {
  it("reads SQLite's missing table, which is the reported case", () => {
    expect(detectMissingRelation(coded("no such table: assets", "SQLITE_ERROR"))).toEqual({
      kind: "table",
      name: "assets",
    });
  });

  it("reads SQLite's missing column", () => {
    expect(detectMissingRelation(coded("no such column: user_id"))).toEqual({
      kind: "column",
      name: "user_id",
    });
  });

  it("reads Postgres by SQLSTATE", () => {
    expect(detectMissingRelation(coded('relation "assets" does not exist', "42P01"))).toEqual({
      kind: "table",
      name: "assets",
    });
    expect(detectMissingRelation(coded('column "slug" does not exist', "42703"))).toEqual({
      kind: "column",
      name: "slug",
    });
  });

  it("reads MySQL by errno", () => {
    expect(
      detectMissingRelation(coded("Table 'app.assets' doesn't exist", undefined, 1146)),
    ).toEqual({ kind: "table", name: "assets" });
    expect(
      detectMissingRelation(coded("Unknown column 'slug' in 'field list'", undefined, 1054)),
    ).toEqual({ kind: "column", name: "slug" });
  });

  it("strips the schema qualifier, so the name is the table", () => {
    expect(
      detectMissingRelation(coded('relation "public"."assets" does not exist', "42P01")),
    ).toEqual({ kind: "table", name: "assets" });
  });

  it("still reports the kind when the code is known but the message is not", () => {
    // A driver that localises or rewraps the message still carries the code, and
    // "some table is missing, and here is what has not run" is still the answer.
    expect(detectMissingRelation(coded("etwas ist schiefgelaufen", "42P01"))).toEqual({
      kind: "table",
      name: "",
    });
  });

  it("claims nothing it does not own", () => {
    for (const error of [
      new Error("UNIQUE constraint failed: users.email"),
      new Error("database is locked"),
      coded('syntax error at or near "SELCT"', "42601"),
      new Error("connection refused"),
      new Error("Cannot read properties of undefined (reading 'id')"),
    ]) {
      expect(detectMissingRelation(error)).toBeNull();
    }
  });
});

describe("the diagnosis token", () => {
  beforeEach(() => _resetDiagnosisTokens());

  it("is accepted once and then spent", () => {
    const token = _mintDiagnosisToken();
    expect(_spendDiagnosisToken(token)).toBe(true);
    // A replayed token is the shape a captured request has.
    expect(_spendDiagnosisToken(token)).toBe(false);
  });

  it("refuses a token it never minted", () => {
    expect(_spendDiagnosisToken(crypto.randomUUID())).toBe(false);
  });

  it("refuses a missing header", () => {
    expect(_spendDiagnosisToken(null)).toBe(false);
    expect(_spendDiagnosisToken("")).toBe(false);
  });

  it("does not grow without bound over a long dev session", () => {
    const first = _mintDiagnosisToken();
    for (let i = 0; i < 64; i++) _mintDiagnosisToken();
    // The oldest was evicted, so an error page left open for hours cannot pin
    // memory — and the stale page's button correctly stops working.
    expect(_spendDiagnosisToken(first)).toBe(false);
  });
});
