import { describe, it, expect } from "bun:test";
import { RuleBuilder, runValidation } from "@zerotal/validator";
import type { Schema } from "@zerotal/validator";
import { textInput, datePicker, select, tagsInput, checkboxList } from "./Field.ts";

// ── Empty-optional dehydration ───────────────────────────────────────────────
// Regression: a blank optional date/select/number used to submit "" and blow up
// the model cast (`Cannot parse date: ""`). dehydrate() now maps blank → null for
// the types where "" is never valid, and parses numeric strings.

describe("Field.dehydrate — empty-optional coercion", () => {
  it("coerces an empty optional date to null", async () => {
    expect(await datePicker("d").dehydrate("")).toBeNull();
    expect(await datePicker("d").dehydrate("   ")).toBeNull();
  });

  it("coerces an empty optional select (FK/enum) to null", async () => {
    expect(await select("author_id").dehydrate("")).toBeNull();
  });

  it("coerces an empty optional number to null and parses numeric strings", async () => {
    expect(await textInput("age").numeric().dehydrate("")).toBeNull();
    expect(await textInput("age").numeric().dehydrate("42")).toBe(42);
    expect(await textInput("age").numeric().dehydrate("3.5")).toBe(3.5);
  });

  it("does NOT coerce a required field (validation handles blanks)", async () => {
    expect(await datePicker("d").required().dehydrate("")).toBe("");
  });

  it("leaves an empty text value as an empty string (NOT NULL DEFAULT '')", async () => {
    expect(await textInput("name").dehydrate("")).toBe("");
  });

  it("passes through a real date string untouched", async () => {
    expect(await datePicker("d").dehydrate("2026-06-30")).toBe("2026-06-30");
  });
});

// ── Array-field validation ───────────────────────────────────────────────────
// Regression: array fields built a `array()` rule with no element rule and threw
// during validation. They now validate as an array of strings.

describe("Field.buildRule — array fields validate without throwing", () => {
  function validate(field: ReturnType<typeof tagsInput>, value: unknown): { success: boolean } {
    const v = new RuleBuilder();
    const schema: Schema = {
      [field._key]: (field.buildRule(v) as unknown as { _def: Schema[string] })._def,
    };
    return runValidation(schema, { [field._key]: value }) as { success: boolean };
  }

  it("accepts a tags array", () => {
    expect(validate(tagsInput("tags"), ["a", "b"]).success).toBe(true);
  });

  it("accepts a checkbox-list array", () => {
    expect(validate(checkboxList("roles"), ["admin"]).success).toBe(true);
  });

  it("accepts an empty optional array", () => {
    expect(validate(tagsInput("tags"), []).success).toBe(true);
  });
});
