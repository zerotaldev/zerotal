import { describe, it, expect } from "bun:test";
import { redactBindings, attributeBindings } from "./redaction.ts";

const MASK = "‹redacted›";

describe("attributeBindings", () => {
  it("pairs INSERT placeholders with their column list", () => {
    expect(
      attributeBindings("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 3),
    ).toEqual(["name", "email", "password"]);
  });

  it("handles quoted identifiers and a qualified table", () => {
    expect(
      attributeBindings('INSERT INTO "app"."users" ("name", "password") VALUES (?, ?)', 2),
    ).toEqual(["name", "password"]);
  });

  it("pairs SET assignments with their columns", () => {
    expect(attributeBindings("UPDATE users SET name = ?, password = ? WHERE id = ?", 3)).toEqual([
      "name",
      "password",
      "id",
    ]);
  });

  it("pairs WHERE comparisons with their columns", () => {
    expect(attributeBindings("SELECT * FROM users WHERE email = ? AND status = ?", 2)).toEqual([
      "email",
      "status",
    ]);
  });

  it("attributes every placeholder of an IN list to the same column", () => {
    expect(attributeBindings("SELECT * FROM users WHERE id IN (?, ?, ?)", 3)).toEqual([
      "id",
      "id",
      "id",
    ]);
  });

  it("strips a table qualifier down to the column", () => {
    expect(attributeBindings("SELECT * FROM users WHERE users.password = ?", 1)).toEqual([
      "password",
    ]);
  });

  it("returns undefined where it cannot attribute a placeholder", () => {
    expect(attributeBindings("SELECT ?", 1)).toEqual([undefined]);
  });
});

describe("redactBindings", () => {
  it("masks a password and leaves the rest readable", () => {
    const out = redactBindings("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [
      "Ada",
      "ada@example.com",
      "hunter2",
    ]);
    expect(out).toEqual(["Ada", "ada@example.com", MASK]);
  });

  it("matches sensitive names as substrings", () => {
    const out = redactBindings(
      "UPDATE users SET password_hash = ?, remember_token = ? WHERE id = ?",
      ["argon2id$…", "abc123", 7],
    );
    expect(out).toEqual([MASK, MASK, 7]);
  });

  it("keeps structural columns readable so a trace stays legible", () => {
    const out = redactBindings("SELECT * FROM posts WHERE id = ? AND created_at > ?", [
      42,
      "2025-01-01",
    ]);
    expect(out).toEqual([42, "2025-01-01"]);
  });

  it("masks a binding it cannot attribute to a column", () => {
    // Guessing "probably fine" in the other direction is what writes a secret to disk.
    expect(redactBindings("SELECT ?", ["mystery"])).toEqual([MASK]);
  });

  it("leaves null and undefined alone — there is nothing to reveal", () => {
    expect(redactBindings("UPDATE u SET password = ? WHERE id = ?", [null, 1])).toEqual([null, 1]);
  });

  it("honours an allow list for a column you need to see", () => {
    const out = redactBindings("SELECT * FROM users WHERE session_id = ?", ["sess_1"], {
      allow: ["session_id"],
    });
    expect(out).toEqual(["sess_1"]);
  });

  it("honours a deny list for a column only this app considers sensitive", () => {
    const out = redactBindings("SELECT * FROM users WHERE nickname = ?", ["ada"], {
      deny: ["nickname"],
    });
    expect(out).toEqual([MASK]);
  });

  it("passes everything through when disabled", () => {
    const out = redactBindings("INSERT INTO users (password) VALUES (?)", ["hunter2"], {
      enabled: false,
    });
    expect(out).toEqual(["hunter2"]);
  });

  it("returns the input untouched when there are no bindings", () => {
    const bindings: unknown[] = [];
    expect(redactBindings("SELECT 1", bindings)).toBe(bindings);
  });

  it("does not modify the array it was given", () => {
    const bindings = ["Ada", "hunter2"];
    redactBindings("INSERT INTO users (name, password) VALUES (?, ?)", bindings);
    expect(bindings).toEqual(["Ada", "hunter2"]);
  });
});
