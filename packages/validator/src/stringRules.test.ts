import { describe, it, expect } from "bun:test";
import { runStringRules, runStringRulesAsync } from "./stringRules.ts";

describe("runStringRules (pipe-delimited string rules)", () => {
  it("flags required + email failures", () => {
    const errors = runStringRules(
      { name: "", email: "nope" },
      {
        name: "required",
        email: "required|email",
      },
    );
    expect(errors.name).toBeDefined();
    expect(errors.email).toBeDefined();
  });

  it("passes valid input", () => {
    expect(
      runStringRules(
        { name: "Al", email: "a@b.com" },
        {
          name: "required|min:2",
          email: "required|email",
        },
      ),
    ).toEqual({});
  });

  it("supports string-array rules and params", () => {
    expect(runStringRules({ p: "ab" }, { p: ["required", "min:3"] }).p).toBeDefined();
    expect(runStringRules({ n: 5 }, { n: "integer|between:1,10" })).toEqual({});
  });

  it("nullable skips when empty; sometimes skips when absent", () => {
    expect(runStringRules({ age: "" }, { age: "nullable|integer" })).toEqual({});
    expect(runStringRules({}, { bio: "sometimes|min:5" })).toEqual({});
  });

  it("confirmed checks the {field}_confirmation companion", () => {
    expect(
      runStringRules({ password: "x", password_confirmation: "y" }, { password: "confirmed" })
        .password,
    ).toBeDefined();
    expect(
      runStringRules({ password: "x", password_confirmation: "x" }, { password: "confirmed" }),
    ).toEqual({});
  });

  it("runStringRulesAsync mirrors the sync result", async () => {
    const errors = await runStringRulesAsync({ email: "bad" }, { email: "email" });
    expect(errors.email).toBeDefined();
  });
});
