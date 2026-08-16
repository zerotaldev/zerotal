import { describe, it, expect } from "bun:test";
import {
  redactBindings,
  redactValue,
  redactCacheKey,
  isSensitiveName,
  attributeBindings,
} from "./redaction.ts";

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

describe("isSensitiveName", () => {
  it("matches the built-in list as a substring", () => {
    expect(isSensitiveName("password_hash")).toBe(true);
    expect(isSensitiveName("API_KEY")).toBe(true);
    expect(isSensitiveName("nickname")).toBe(false);
  });

  it("keeps structural names readable", () => {
    expect(isSensitiveName("id")).toBe(false);
    expect(isSensitiveName("created_at")).toBe(false);
  });

  it("honours allow and deny", () => {
    expect(isSensitiveName("session_id", { allow: ["session_id"] })).toBe(false);
    expect(isSensitiveName("nickname", { deny: ["nickname"] })).toBe(true);
  });
});

describe("redactValue", () => {
  it("masks a field whose name says it holds a secret", () => {
    expect(redactValue({ email: "ada@example.com", password: "hunter2" })).toEqual({
      email: "ada@example.com",
      password: MASK,
    });
  });

  it("masks nested fields, not just the top level", () => {
    expect(redactValue({ user: { name: "Ada", api_key: "sk-live-…" } })).toEqual({
      user: { name: "Ada", api_key: MASK },
    });
  });

  it("walks arrays", () => {
    expect(redactValue([{ token: "a" }, { token: "b" }])).toEqual([
      { token: MASK },
      { token: MASK },
    ]);
  });

  it("leaves a bare scalar alone — there is no name to judge it by", () => {
    expect(redactValue("a string that happens to be a token")).toBe(
      "a string that happens to be a token",
    );
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
  });

  it("replaces a cycle rather than following it", () => {
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;
    expect(redactValue(node)).toEqual({ name: "root", self: "‹circular›" });
  });

  it("renders the same object twice when it is shared, not circular", () => {
    const shared = { name: "Ada" };
    expect(redactValue({ a: shared, b: shared })).toEqual({
      a: { name: "Ada" },
      b: { name: "Ada" },
    });
  });

  it("stops at the depth limit", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(redactValue(deep)).toEqual({
      a: { b: { c: { d: { e: { f: "‹truncated›" } } } } },
    });
  });

  it("flattens dates and errors instead of walking them", () => {
    const out = redactValue({
      at: new Date("2026-08-15T00:00:00.000Z"),
      err: new TypeError("nope"),
    }) as Record<string, unknown>;
    expect(out["at"]).toBe("2026-08-15T00:00:00.000Z");
    expect(out["err"]).toBe("TypeError: nope");
  });

  it("produces something JSON.stringify survives", () => {
    const node: Record<string, unknown> = { password: "hunter2" };
    node["self"] = node;
    expect(() => JSON.stringify(redactValue(node))).not.toThrow();
  });

  it("passes everything through when disabled", () => {
    const input = { password: "hunter2" };
    expect(redactValue(input, { enabled: false })).toBe(input);
  });

  it("does not modify the value it was given", () => {
    const input = { password: "hunter2" };
    redactValue(input);
    expect(input).toEqual({ password: "hunter2" });
  });
});

describe("redactCacheKey", () => {
  it("masks what follows a sensitive segment and keeps the name", () => {
    expect(redactCacheKey("password_reset:9f2c4a")).toBe("password_reset:‹redacted›");
    expect(redactCacheKey("session:abc123")).toBe("session:‹redacted›");
  });

  it("splits on the separators cache keys are actually built from", () => {
    expect(redactCacheKey("auth.token.9f2c")).toBe("auth.‹redacted›.‹redacted›");
    expect(redactCacheKey("app/otp/44121")).toBe("app/otp/‹redacted›");
  });

  it("does not split a name on its own underscores", () => {
    // `password_reset` is one word; masking `reset` would cost the row its
    // identity without hiding anything.
    expect(redactCacheKey("password_reset:9f2c4a")).toBe("password_reset:‹redacted›");
  });

  it("leaves an ordinary key completely alone", () => {
    expect(redactCacheKey("posts:page:2")).toBe("posts:page:2");
    expect(redactCacheKey("user:42:profile")).toBe("user:42:profile");
  });

  it("keeps a key whose sensitive segment is the last one — nothing follows it", () => {
    expect(redactCacheKey("user:42:token")).toBe("user:42:token");
  });

  it("masks a single-segment key whole, having no name to keep it by", () => {
    expect(redactCacheKey("sessionabc123")).toBe(MASK);
  });

  it("passes everything through when disabled", () => {
    expect(redactCacheKey("session:abc", { enabled: false })).toBe("session:abc");
  });
});
